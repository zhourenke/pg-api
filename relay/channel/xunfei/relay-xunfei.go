package xunfei

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// https://console.xfyun.cn/services/cbm
// https://www.xfyun.cn/doc/spark/Web.html

func requestOpenAI2Xunfei(request dto.GeneralOpenAIRequest, xunfeiAppId string, domain string) *XunfeiChatRequest {
	messages := make([]XunfeiMessage, 0, len(request.Messages))
	shouldCovertSystemMessage := !strings.HasSuffix(request.Model, "3.5")
	for _, message := range request.Messages {
		if message.Role == "system" && shouldCovertSystemMessage {
			messages = append(messages, XunfeiMessage{
				Role:    "user",
				Content: message.StringContent(),
			})
			messages = append(messages, XunfeiMessage{
				Role:    "assistant",
				Content: "Okay",
			})
		} else {
			messages = append(messages, XunfeiMessage{
				Role:    message.Role,
				Content: message.StringContent(),
			})
		}
	}
	xunfeiRequest := XunfeiChatRequest{}
	xunfeiRequest.Header.AppId = xunfeiAppId
	xunfeiRequest.Parameter.Chat.Domain = domain
	xunfeiRequest.Parameter.Chat.Temperature = request.Temperature
	// 讯飞的 top_k 是采样参数，OpenAI 的 n 是候选数：两者不是一回事，所以只带上客户端自己
	// 传的 top_k，越界与没传都交给厂商用默认值。（这条以前拿 n 去填 top_k。）
	if request.TopK != nil && *request.TopK >= 1 && *request.TopK <= xunfeiTopKMax {
		xunfeiRequest.Parameter.Chat.TopK = *request.TopK
	}
	xunfeiRequest.Parameter.Chat.MaxTokens = request.GetMaxTokens()
	xunfeiRequest.Payload.Message.Text = messages
	return &xunfeiRequest
}

// responseXunfei2OpenAI 把讯飞的一整轮回答拼成 chat 响应。它同时是转换 Anthropic Messages
// 和 generateContent 时的中间体，所以 id 与 model 都在这里带上。
func responseXunfei2OpenAI(response *XunfeiChatResponse, id string, model string) *dto.OpenAITextResponse {
	if len(response.Payload.Choices.Text) == 0 {
		response.Payload.Choices.Text = []XunfeiChatResponseTextItem{
			{
				Content: "",
			},
		}
	}
	choice := dto.OpenAITextResponseChoice{
		Index: 0,
		Message: dto.Message{
			Role:    "assistant",
			Content: response.Payload.Choices.Text[0].Content,
		},
		FinishReason: constant.FinishReasonStop,
	}
	fullTextResponse := dto.OpenAITextResponse{
		Id:      id,
		Object:  "chat.completion",
		Created: common.GetTimestamp(),
		Model:   model,
		Choices: []dto.OpenAITextResponseChoice{choice},
		Usage:   response.Payload.Usage.Text,
	}
	return &fullTextResponse
}

// streamResponseXunfei2OpenAI 把讯飞的一帧拼成 chat 流式分片。讯飞自己在帧里只放状态和
// 用量，没有结束原因，status 2 那一帧才补上。
func streamResponseXunfei2OpenAI(xunfeiResponse *XunfeiChatResponse, id string, model string) *dto.ChatCompletionsStreamResponse {
	if len(xunfeiResponse.Payload.Choices.Text) == 0 {
		xunfeiResponse.Payload.Choices.Text = []XunfeiChatResponseTextItem{
			{
				Content: "",
			},
		}
	}
	var choice dto.ChatCompletionsStreamResponseChoice
	choice.Delta.SetContentString(xunfeiResponse.Payload.Choices.Text[0].Content)
	if xunfeiResponse.Payload.Choices.Status == 2 {
		choice.FinishReason = &constant.FinishReasonStop
	}
	response := dto.ChatCompletionsStreamResponse{
		Id:      id,
		Object:  "chat.completion.chunk",
		Created: common.GetTimestamp(),
		Model:   model,
		Choices: []dto.ChatCompletionsStreamResponseChoice{choice},
	}
	return &response
}

func buildXunfeiAuthUrl(hostUrl string, apiKey, apiSecret string) string {
	HmacWithShaToBase64 := func(algorithm, data, key string) string {
		mac := hmac.New(sha256.New, []byte(key))
		mac.Write([]byte(data))
		encodeData := mac.Sum(nil)
		return base64.StdEncoding.EncodeToString(encodeData)
	}
	ul, err := url.Parse(hostUrl)
	if err != nil {
		fmt.Println(err)
	}
	date := time.Now().UTC().Format(time.RFC1123)
	signString := []string{"host: " + ul.Host, "date: " + date, "GET " + ul.Path + " HTTP/1.1"}
	sign := strings.Join(signString, "\n")
	sha := HmacWithShaToBase64("hmac-sha256", sign, apiSecret)
	authUrl := fmt.Sprintf("hmac username=\"%s\", algorithm=\"%s\", headers=\"%s\", signature=\"%s\"", apiKey,
		"hmac-sha256", "host date request-line", sha)
	authorization := base64.StdEncoding.EncodeToString([]byte(authUrl))
	v := url.Values{}
	v.Add("host", ul.Host)
	v.Add("date", date)
	v.Add("authorization", authorization)
	callUrl := hostUrl + "?" + v.Encode()
	return callUrl
}

func xunfeiStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, conn *websocket.Conn, textRequest dto.GeneralOpenAIRequest, appId string, domain string) (*dto.Usage, *types.NewAPIError) {
	dataChan, stopChan, err := xunfeiMakeRequest(c, conn, textRequest, domain, appId)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeDoRequestFailed)
	}
	helper.SetEventStreamHeaders(c)
	id := helper.GetResponseID(c)
	var usage dto.Usage
	var lastStreamData string
	c.Stream(func(w io.Writer) bool {
		select {
		case xunfeiResponse := <-dataChan:
			usage.PromptTokens += xunfeiResponse.Payload.Usage.Text.PromptTokens
			usage.CompletionTokens += xunfeiResponse.Payload.Usage.Text.CompletionTokens
			usage.TotalTokens += xunfeiResponse.Payload.Usage.Text.TotalTokens
			response := streamResponseXunfei2OpenAI(&xunfeiResponse, id, info.UpstreamModelName)
			if info.RelayFormat == types.RelayFormatOpenAI {
				if err := helper.ObjectData(c, response); err != nil {
					common.SysLog(err.Error())
				}
				return true
			}
			// 讯飞帧里的状态和用量不是转换后的格式能读的结束原因：正文增量照转，收尾
			// 交给下面那一帧。
			response.Choices[0].FinishReason = nil
			if response.Choices[0].Delta.GetContentString() == "" {
				return true
			}
			if apiErr := emitXunfeiStreamChunk(c, info, *response, &lastStreamData); apiErr != nil {
				common.SysLog(apiErr.Error())
				return false
			}
			return true
		case <-stopChan:
			if info.RelayFormat != types.RelayFormatOpenAI {
				// 转换后的协议都要一帧带结束原因和用量的收尾分片才闭合，讯飞自己不给
				// 这样一帧，所以在这里补一帧，再交给该协议的收尾逻辑。
				finishReason := constant.FinishReasonStop
				terminal := dto.ChatCompletionsStreamResponse{
					Id:      id,
					Object:  "chat.completion.chunk",
					Created: common.GetTimestamp(),
					Model:   info.UpstreamModelName,
					Choices: []dto.ChatCompletionsStreamResponseChoice{{Index: 0, FinishReason: &finishReason}},
					Usage:   &usage,
				}
				if apiErr := emitXunfeiStreamChunk(c, info, terminal, &lastStreamData); apiErr != nil {
					common.SysLog(apiErr.Error())
					return false
				}
				// 转换后的格式以各自的收尾事件结束，而不是 chat 的 [DONE]；Claude 那
				// 条路还需要属于这条流的状态。
				info.EnsureClaudeConvertInfo()
				openai.HandleFinalResponse(c, info, lastStreamData, id, common.GetTimestamp(), info.UpstreamModelName, "", &usage, false)
				return false
			}
			helper.Done(c)
			return false
		}
	})
	return &usage, nil
}

// emitXunfeiStreamChunk 把一帧 chat 分片交给用另一种协议提问的客户端，作为该协议渲染器要
// 转换的中间体，于是一条讯飞流同时服务三种格式。
func emitXunfeiStreamChunk(c *gin.Context, info *relaycommon.RelayInfo, chunk dto.ChatCompletionsStreamResponse, lastStreamData *string) *types.NewAPIError {
	encoded, err := common.Marshal(chunk)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	*lastStreamData = string(encoded)
	if err := openai.HandleStreamFormat(c, info, *lastStreamData, false, false); err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	return nil
}

func xunfeiHandler(c *gin.Context, info *relaycommon.RelayInfo, conn *websocket.Conn, textRequest dto.GeneralOpenAIRequest, appId string, domain string) (*dto.Usage, *types.NewAPIError) {
	dataChan, stopChan, err := xunfeiMakeRequest(c, conn, textRequest, domain, appId)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeDoRequestFailed)
	}
	var usage dto.Usage
	var content string
	var xunfeiResponse XunfeiChatResponse
	stop := false
	for !stop {
		select {
		case xunfeiResponse = <-dataChan:
			if len(xunfeiResponse.Payload.Choices.Text) == 0 {
				continue
			}
			content += xunfeiResponse.Payload.Choices.Text[0].Content
			usage.PromptTokens += xunfeiResponse.Payload.Usage.Text.PromptTokens
			usage.CompletionTokens += xunfeiResponse.Payload.Usage.Text.CompletionTokens
			usage.TotalTokens += xunfeiResponse.Payload.Usage.Text.TotalTokens
		case stop = <-stopChan:
		}
	}
	if len(xunfeiResponse.Payload.Choices.Text) == 0 {
		xunfeiResponse.Payload.Choices.Text = []XunfeiChatResponseTextItem{
			{
				Content: "",
			},
		}
	}
	xunfeiResponse.Payload.Choices.Text[0].Content = content

	// 这一份 chat 响应就是转换 Anthropic Messages 和 generateContent 时的中间体：整轮
	// 回答已经拼接完，协议自己的渲染器只负责转写。
	response := responseXunfei2OpenAI(&xunfeiResponse, helper.GetResponseID(c), info.UpstreamModelName)
	var body any = response
	if info.RelayFormat != types.RelayFormatOpenAI {
		convertResult, err := service.ConvertResponse(c, info, info.RelayFormat, response)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		body = convertResult.Value
	}
	jsonResponse, err := common.Marshal(body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	_, _ = c.Writer.Write(jsonResponse)
	return &usage, nil
}

func xunfeiMakeRequest(c *gin.Context, conn *websocket.Conn, textRequest dto.GeneralOpenAIRequest, domain, appId string) (chan XunfeiChatResponse, chan bool, error) {
	data := requestOpenAI2Xunfei(textRequest, appId, domain)
	err := conn.WriteJSON(data)
	if err != nil {
		return nil, nil, err
	}

	dataChan := make(chan XunfeiChatResponse)
	// 读取协程收尾时要把最后的结果交给 stopChan：缓冲一格，客户端提前断开时它才不会
	// 卡在没人再读的 stopChan 上。
	stopChan := make(chan bool, 1)
	go func() {
		defer func() {
			conn.Close()
		}()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				common.SysLog("error reading stream response: " + err.Error())
				break
			}
			var response XunfeiChatResponse
			err = common.Unmarshal(msg, &response)
			if err != nil {
				common.SysLog("error unmarshalling stream response: " + err.Error())
				break
			}
			select {
			case dataChan <- response:
			case <-c.Request.Context().Done():
				stopChan <- true
				return
			}
			if response.Payload.Choices.Status == 2 {
				break
			}
		}
		stopChan <- true
	}()

	return dataChan, stopChan, nil
}

func apiVersion2domain(apiVersion string) string {
	switch apiVersion {
	case "v1.1":
		return "lite"
	case "v2.1":
		return "generalv2"
	case "v3.1":
		return "generalv3"
	case "v3.5":
		return "generalv3.5"
	case "v4.0":
		return "4.0Ultra"
	}
	return "general" + apiVersion
}

// getXunfeiAuthUrl 解析请求体要带的 domain 和要拨的签名 websocket url。版本号依次看请求的
// api-version 查询参数、模型名、渠道里配置的版本；端点用渠道的 base url 拼上该版本的路径，
// 渠道的 base url 因此才开始生效（此前这个主机是写死的 spark-api.xf-yun.com）。
func getXunfeiAuthUrl(c *gin.Context, info *relaycommon.RelayInfo, apiKey string, apiSecret string, modelName string) (string, string) {
	apiVersion := getAPIVersion(c, modelName)
	domain := apiVersion2domain(apiVersion)
	baseUrl := info.ChannelBaseUrl
	if baseUrl == "" {
		baseUrl = "https://spark-api.xf-yun.com"
	}
	authUrl := buildXunfeiAuthUrl(fmt.Sprintf("%s/%s/chat", strings.TrimSuffix(baseUrl, "/"), apiVersion), apiKey, apiSecret)
	return domain, authUrl
}

func getAPIVersion(c *gin.Context, modelName string) string {
	query := c.Request.URL.Query()
	apiVersion := query.Get("api-version")
	if apiVersion != "" {
		return apiVersion
	}
	parts := strings.Split(modelName, "-")
	if len(parts) == 2 {
		apiVersion = parts[1]
		return apiVersion

	}
	apiVersion = c.GetString("api_version")
	if apiVersion != "" {
		return apiVersion
	}
	apiVersion = "v1.1"
	common.SysLog("api_version not found, using default: " + apiVersion)
	return apiVersion
}
