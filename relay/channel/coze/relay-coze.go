package coze

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/samber/lo"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
)

func convertCozeChatRequest(c *gin.Context, request dto.GeneralOpenAIRequest) *CozeChatRequest {
	var messages []CozeEnterMessage
	// 将 request的messages的role为user的content转换为CozeMessage
	for _, message := range request.Messages {
		if message.Role == "user" {
			messages = append(messages, CozeEnterMessage{
				Role:    "user",
				Content: message.Content,
				// TODO: support more content type
				ContentType: "text",
			})
		}
	}
	user := request.User
	if len(user) == 0 {
		// Coze takes user_id as a JSON string, and the request id is one once
		// quoted: the bare id would make the whole body invalid JSON, which is
		// what every request without a user field used to send.
		user = json.RawMessage(strconv.Quote(helper.GetResponseID(c)))
	}
	cozeRequest := &CozeChatRequest{
		BotId:              c.GetString("bot_id"),
		UserId:             user,
		AdditionalMessages: messages,
		Stream:             lo.FromPtrOr(request.Stream, false),
	}
	return cozeRequest
}

// cozeChatHandler renders the message list a completed /v3/chat run produced. The
// chat body it builds is also the intermediate the other protocols are converted
// from, so the same bot serves Anthropic Messages and generateContent.
func cozeChatHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.CloseResponseBodyGracefully(resp)
	// convert coze response to openai response
	var cozeResponse CozeChatDetailResponse
	err = json.Unmarshal(responseBody, &cozeResponse)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	if cozeResponse.Code != 0 {
		return nil, types.NewError(errors.New(cozeResponse.Msg), types.ErrorCodeBadResponseBody)
	}
	// 从上下文获取 usage
	var usage dto.Usage
	usage.PromptTokens = c.GetInt("coze_input_count")
	usage.CompletionTokens = c.GetInt("coze_output_count")
	usage.TotalTokens = c.GetInt("coze_token_count")

	response := dto.OpenAITextResponse{
		Id:      helper.GetResponseID(c),
		Object:  "chat.completion",
		Created: common.GetTimestamp(),
		Model:   info.UpstreamModelName,
		Usage:   usage,
	}
	// The intermediate carries the answer as plain text: the converted formats
	// read the message content as a string, and the chat shape is unchanged.
	var answer string
	for _, data := range cozeResponse.Data {
		if data.Type != "answer" {
			continue
		}
		if err := json.Unmarshal(data.Content, &answer); err != nil {
			common.SysLog("error_unmarshalling_answer_content: " + err.Error())
			continue
		}
		response.Created = data.CreatedAt
	}
	// 添加 response.Choices
	response.Choices = []dto.OpenAITextResponseChoice{
		{
			Index:        0,
			Message:      dto.Message{Role: "assistant", Content: answer},
			FinishReason: "stop",
		},
	}
	jsonResponse, err := common.Marshal(response)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	if info.RelayFormat != types.RelayFormatOpenAI {
		convertResult, err := service.ConvertResponse(c, info, info.RelayFormat, &response)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		jsonResponse, err = common.Marshal(convertResult.Value)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = c.Writer.Write(jsonResponse)

	return &usage, nil
}

func cozeChatStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	scanner := helper.NewStreamScanner(resp.Body)
	scanner.Split(bufio.ScanLines)
	helper.SetEventStreamHeaders(c)
	id := helper.GetResponseID(c)
	var responseText string

	var currentEvent string
	var currentData string
	var usage = &dto.Usage{}
	var lastStreamData string

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			if currentEvent != "" && currentData != "" {
				// handle last event
				if apiErr := handleCozeEvent(c, currentEvent, currentData, &responseText, usage, id, info, &lastStreamData); apiErr != nil {
					return nil, apiErr
				}
				currentEvent = ""
				currentData = ""
			}
			continue
		}

		if strings.HasPrefix(line, "event:") {
			currentEvent = strings.TrimSpace(line[6:])
			continue
		}

		if strings.HasPrefix(line, "data:") {
			currentData = strings.TrimSpace(line[5:])
			continue
		}
	}

	// Last event
	if currentEvent != "" && currentData != "" {
		if apiErr := handleCozeEvent(c, currentEvent, currentData, &responseText, usage, id, info, &lastStreamData); apiErr != nil {
			return nil, apiErr
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}

	if usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, responseText, info.UpstreamModelName, c.GetInt("coze_input_count"))
	}

	if info.RelayFormat != types.RelayFormatOpenAI {
		// Coze's own chunks carry neither a finish reason nor the usage (that
		// arrives in conversation.chat.completed), and both converted formats
		// close over a terminal chat chunk that has them. It also opens the
		// protocol when the run sent no delta event at all.
		finishReason := "stop"
		terminal := dto.ChatCompletionsStreamResponse{
			Id:      id,
			Object:  "chat.completion.chunk",
			Created: common.GetTimestamp(),
			Model:   info.UpstreamModelName,
			Choices: []dto.ChatCompletionsStreamResponseChoice{{Index: 0, FinishReason: &finishReason}},
			Usage:   usage,
		}
		if apiErr := emitCozeStreamChunk(c, info, terminal, &lastStreamData); apiErr != nil {
			return nil, apiErr
		}
		// The converted formats end with their own closing event instead of a
		// chat [DONE]; the Claude path needs its per-stream state.
		info.EnsureClaudeConvertInfo()
		openai.HandleFinalResponse(c, info, lastStreamData, id, common.GetTimestamp(), info.UpstreamModelName, "", usage, false)
		return usage, nil
	}

	helper.Done(c)

	return usage, nil
}

// emitCozeStreamChunk sends one chat chunk as the OpenAI stream, or -- for a
// client that asked in another protocol -- as the intermediate that protocol's
// renderer converts, so one Coze event stream serves all three formats.
func emitCozeStreamChunk(c *gin.Context, info *relaycommon.RelayInfo, chunk dto.ChatCompletionsStreamResponse, lastStreamData *string) *types.NewAPIError {
	if info.RelayFormat == types.RelayFormatOpenAI {
		if err := helper.ObjectData(c, chunk); err != nil {
			common.SysLog(err.Error())
		}
		return nil
	}
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

func handleCozeEvent(c *gin.Context, event string, data string, responseText *string, usage *dto.Usage, id string, info *relaycommon.RelayInfo, lastStreamData *string) *types.NewAPIError {
	switch event {
	case "conversation.chat.completed":
		// 将 data 解析为 CozeChatResponseData
		var chatData CozeChatResponseData
		err := json.Unmarshal([]byte(data), &chatData)
		if err != nil {
			common.SysLog("error_unmarshalling_stream_response: " + err.Error())
			return nil
		}

		usage.PromptTokens = chatData.Usage.InputCount
		usage.CompletionTokens = chatData.Usage.OutputCount
		usage.TotalTokens = chatData.Usage.TokenCount

		// A converted format is closed by the terminal chunk built at the end of
		// the stream, so the stop frame belongs to the OpenAI path alone.
		if info.RelayFormat != types.RelayFormatOpenAI {
			return nil
		}
		stopResponse := helper.GenerateStopResponse(id, common.GetTimestamp(), info.UpstreamModelName, "stop")
		if err := helper.ObjectData(c, stopResponse); err != nil {
			common.SysLog(err.Error())
		}

	case "conversation.message.delta":
		// 将 data 解析为 CozeChatV3MessageDetail
		var messageData CozeChatV3MessageDetail
		err := json.Unmarshal([]byte(data), &messageData)
		if err != nil {
			common.SysLog("error_unmarshalling_stream_response: " + err.Error())
			return nil
		}

		var content string
		err = json.Unmarshal(messageData.Content, &content)
		if err != nil {
			common.SysLog("error_unmarshalling_stream_response: " + err.Error())
			return nil
		}

		*responseText += content

		openaiResponse := dto.ChatCompletionsStreamResponse{
			Id:      id,
			Object:  "chat.completion.chunk",
			Created: common.GetTimestamp(),
			Model:   info.UpstreamModelName,
		}

		choice := dto.ChatCompletionsStreamResponseChoice{
			Index: 0,
		}
		choice.Delta.SetContentString(content)
		openaiResponse.Choices = append(openaiResponse.Choices, choice)

		return emitCozeStreamChunk(c, info, openaiResponse, lastStreamData)

	case "error":
		var errorData CozeError
		err := json.Unmarshal([]byte(data), &errorData)
		if err != nil {
			common.SysLog("error_unmarshalling_stream_response: " + err.Error())
			return nil
		}

		common.SysLog(fmt.Sprintf("stream event error: %v %v", errorData.Code, errorData.Message))
	}
	return nil
}

func checkIfChatComplete(a *Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (error, bool) {
	requestURL := fmt.Sprintf("%s/v3/chat/retrieve", info.ChannelBaseUrl)

	requestURL = requestURL + "?conversation_id=" + c.GetString("coze_conversation_id") + "&chat_id=" + c.GetString("coze_chat_id")
	// 将 conversationId和chatId作为参数发送get请求
	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return err, false
	}
	err = a.SetupRequestHeader(c, &req.Header, info)
	if err != nil {
		return err, false
	}

	resp, err := doRequest(req, info) // 调用 doRequest
	if err != nil {
		return err, false
	}
	if resp == nil { // 确保在 doRequest 失败时 resp 不为 nil 导致 panic
		return fmt.Errorf("resp is nil"), false
	}
	defer resp.Body.Close() // 确保响应体被关闭

	// 解析 resp 到 CozeChatResponse
	var cozeResponse CozeChatResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body failed: %w", err), false
	}
	err = json.Unmarshal(responseBody, &cozeResponse)
	if err != nil {
		return fmt.Errorf("unmarshal response body failed: %w", err), false
	}
	if cozeResponse.Data.Status == "completed" {
		// 在上下文设置 usage
		c.Set("coze_token_count", cozeResponse.Data.Usage.TokenCount)
		c.Set("coze_output_count", cozeResponse.Data.Usage.OutputCount)
		c.Set("coze_input_count", cozeResponse.Data.Usage.InputCount)
		return nil, true
	} else if cozeResponse.Data.Status == "failed" || cozeResponse.Data.Status == "canceled" || cozeResponse.Data.Status == "requires_action" {
		return fmt.Errorf("chat status: %s", cozeResponse.Data.Status), false
	} else {
		return nil, false
	}
}

func getChatDetail(a *Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (*http.Response, error) {
	requestURL := fmt.Sprintf("%s/v3/chat/message/list", info.ChannelBaseUrl)

	requestURL = requestURL + "?conversation_id=" + c.GetString("coze_conversation_id") + "&chat_id=" + c.GetString("coze_chat_id")
	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("new request failed: %w", err)
	}
	err = a.SetupRequestHeader(c, &req.Header, info)
	if err != nil {
		return nil, fmt.Errorf("setup request header failed: %w", err)
	}
	resp, err := doRequest(req, info)
	if err != nil {
		return nil, fmt.Errorf("do request failed: %w", err)
	}
	return resp, nil
}

func doRequest(req *http.Request, info *relaycommon.RelayInfo) (*http.Response, error) {
	client, err := service.GetHttpClientWithProxySettings(info.ChannelSetting.Proxy, info.ChannelSetting)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil { // 增加对 client.Do(req) 返回错误的检查
		return nil, fmt.Errorf("client.Do failed: %w", err)
	}
	// _ = resp.Body.Close()
	return resp, nil
}
