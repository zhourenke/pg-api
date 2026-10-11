package tencent

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
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
)

// https://cloud.tencent.com/document/product/1729/97732

func requestOpenAI2Tencent(a *Adaptor, request dto.GeneralOpenAIRequest) *TencentChatRequest {
	messages := make([]*TencentMessage, 0, len(request.Messages))
	for i := 0; i < len(request.Messages); i++ {
		message := request.Messages[i]
		messages = append(messages, &TencentMessage{
			Content: message.StringContent(),
			Role:    message.Role,
		})
	}
	var req = TencentChatRequest{
		Stream:   request.Stream,
		Messages: messages,
		Model:    &request.Model,
	}
	if request.TopP != nil {
		req.TopP = request.TopP
	}
	req.Temperature = request.Temperature
	return &req
}

func responseTencent2OpenAI(response *TencentChatResponse) *dto.OpenAITextResponse {
	fullTextResponse := dto.OpenAITextResponse{
		Id:      response.Id,
		Object:  "chat.completion",
		Created: common.GetTimestamp(),
		Usage: dto.Usage{
			PromptTokens:     response.Usage.PromptTokens,
			CompletionTokens: response.Usage.CompletionTokens,
			TotalTokens:      response.Usage.TotalTokens,
		},
	}
	if len(response.Choices) > 0 {
		choice := dto.OpenAITextResponseChoice{
			Index: 0,
			Message: dto.Message{
				Role:    "assistant",
				Content: response.Choices[0].Messages.Content,
			},
			FinishReason: response.Choices[0].FinishReason,
		}
		fullTextResponse.Choices = append(fullTextResponse.Choices, choice)
	}
	return &fullTextResponse
}

// Every frame of a Tencent stream carries the upstream conversation id and names
// the model that answered it; the model used to be the literal "tencent-hunyuan"
// on all of them and the id was empty.
func streamResponseTencent2OpenAI(tencentResponse *TencentChatResponse, model string) *dto.ChatCompletionsStreamResponse {
	response := dto.ChatCompletionsStreamResponse{
		Id:      tencentResponse.Id,
		Object:  "chat.completion.chunk",
		Created: common.GetTimestamp(),
		Model:   model,
	}
	if len(tencentResponse.Choices) > 0 {
		var choice dto.ChatCompletionsStreamResponseChoice
		choice.Delta.SetContentString(tencentResponse.Choices[0].Delta.Content)
		if tencentResponse.Choices[0].FinishReason == "stop" {
			choice.FinishReason = &constant.FinishReasonStop
		}
		response.Choices = append(response.Choices, choice)
	}
	return &response
}

// A client that asked in the Anthropic or the Gemini protocol gets that protocol
// back: this channel has no dialect of its own for either, so the chat chunks and
// the chat body built here are the intermediates they are rendered from. The two
// formats are named instead of testing for "not OpenAI" so that both response
// handlers ask the same question, and so that a future format on this channel does
// not silently join the converted path.
func isConvertedRelayFormat(info *relaycommon.RelayInfo) bool {
	switch info.RelayFormat {
	case types.RelayFormatClaude, types.RelayFormatGemini:
		return true
	}
	return false
}

// A Tencent stream is a run of frames holding answer text plus one frame carrying
// the finish reason, which is what this channel always used to detect the end of
// the answer. The OpenAI format keeps the frames it always sent and closes with
// the [DONE] marker; a client that asked in another protocol gets that protocol
// back, rendered from the same chat chunks and closed by the terminal frame.
func tencentStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	var responseText strings.Builder
	lastStreamData := ""
	scanner := helper.NewStreamScanner(resp.Body)
	scanner.Split(bufio.ScanLines)

	helper.SetEventStreamHeaders(c)

	for scanner.Scan() {
		data := scanner.Text()
		if len(data) < 5 || !strings.HasPrefix(data, "data:") {
			continue
		}
		data = strings.TrimPrefix(data, "data:")

		var tencentResponse TencentChatResponse
		err := common.Unmarshal([]byte(data), &tencentResponse)
		if err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			continue
		}

		response := streamResponseTencent2OpenAI(&tencentResponse, info.UpstreamModelName)
		if len(response.Choices) != 0 {
			responseText.WriteString(response.Choices[0].Delta.GetContentString())
		}

		if !isConvertedRelayFormat(info) {
			err = helper.ObjectData(c, response)
			if err != nil {
				common.SysLog(err.Error())
			}
			continue
		}
		encoded, err := common.Marshal(response)
		if err != nil {
			common.SysLog("error marshalling stream response: " + err.Error())
			continue
		}
		lastStreamData = string(encoded)
		if err := openai.HandleStreamFormat(c, info, lastStreamData, false, false); err != nil {
			common.SysLog("error converting stream response: " + err.Error())
		}
	}

	if err := scanner.Err(); err != nil {
		common.SysLog("error reading stream: " + err.Error())
	}

	usage := service.ResponseText2Usage(c, responseText.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
	if isConvertedRelayFormat(info) {
		// The converted formats end with their own closing event instead of a chat
		// [DONE], and the Claude path needs its per-stream state. The terminal
		// frame carries the finish reason but no usage, so the closing event is
		// emitted here, from the usage this request is billed with.
		info.EnsureClaudeConvertInfo()
		openai.HandleFinalResponse(c, info, lastStreamData, helper.GetResponseID(c), common.GetTimestamp(), info.UpstreamModelName, "", usage, false)
	} else {
		helper.Done(c)
	}
	service.CloseResponseBodyGracefully(resp)

	return usage, nil
}

func tencentHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	var tencentSb TencentChatResponseSB
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	err = common.Unmarshal(responseBody, &tencentSb)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if tencentSb.Response.Error.Code != 0 {
		return nil, types.WithOpenAIError(types.OpenAIError{
			Message: tencentSb.Response.Error.Message,
			Code:    tencentSb.Response.Error.Code,
		}, resp.StatusCode)
	}
	fullTextResponse := responseTencent2OpenAI(&tencentSb.Response)
	// The chat body is the intermediate the converted formats are rendered from,
	// and an empty model name is what it used to carry for every format.
	fullTextResponse.Model = info.UpstreamModelName
	var jsonResponse []byte
	if isConvertedRelayFormat(info) {
		convertResult, err := service.ConvertResponse(c, info, info.RelayFormat, fullTextResponse)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		jsonResponse, err = common.Marshal(convertResult.Value)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
	} else {
		jsonResponse, err = common.Marshal(fullTextResponse)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	service.IOCopyBytesGracefully(c, resp, jsonResponse)
	return &fullTextResponse.Usage, nil
}

func parseTencentConfig(config string) (appId int64, secretId string, secretKey string, err error) {
	parts := strings.Split(config, "|")
	if len(parts) != 3 {
		err = errors.New("invalid tencent config")
		return
	}
	appId, err = strconv.ParseInt(parts[0], 10, 64)
	secretId = parts[1]
	secretKey = parts[2]
	return
}

func sha256hex(s string) string {
	b := sha256.Sum256([]byte(s))
	return hex.EncodeToString(b[:])
}

func hmacSha256(s, key string) string {
	hashed := hmac.New(sha256.New, []byte(key))
	hashed.Write([]byte(s))
	return string(hashed.Sum(nil))
}

func getTencentSign(req TencentChatRequest, adaptor *Adaptor, secId, secKey string) string {
	// build canonical request string
	host := "hunyuan.tencentcloudapi.com"
	httpRequestMethod := "POST"
	canonicalURI := "/"
	canonicalQueryString := ""
	canonicalHeaders := fmt.Sprintf("content-type:%s\nhost:%s\nx-tc-action:%s\n",
		"application/json", host, strings.ToLower(adaptor.Action))
	signedHeaders := "content-type;host;x-tc-action"
	payload, _ := common.Marshal(req)
	hashedRequestPayload := sha256hex(string(payload))
	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		httpRequestMethod,
		canonicalURI,
		canonicalQueryString,
		canonicalHeaders,
		signedHeaders,
		hashedRequestPayload)
	// build string to sign
	algorithm := "TC3-HMAC-SHA256"
	requestTimestamp := strconv.FormatInt(adaptor.Timestamp, 10)
	timestamp, _ := strconv.ParseInt(requestTimestamp, 10, 64)
	t := time.Unix(timestamp, 0).UTC()
	// must be the format 2006-01-02, ref to package time for more info
	date := t.Format("2006-01-02")
	credentialScope := fmt.Sprintf("%s/%s/tc3_request", date, "hunyuan")
	hashedCanonicalRequest := sha256hex(canonicalRequest)
	string2sign := fmt.Sprintf("%s\n%s\n%s\n%s",
		algorithm,
		requestTimestamp,
		credentialScope,
		hashedCanonicalRequest)

	// sign string
	secretDate := hmacSha256(date, "TC3"+secKey)
	secretService := hmacSha256("hunyuan", secretDate)
	secretKey := hmacSha256("tc3_request", secretService)
	signature := hex.EncodeToString([]byte(hmacSha256(string2sign, secretKey)))

	// build authorization
	authorization := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm,
		secId,
		credentialScope,
		signedHeaders,
		signature)
	return authorization
}
