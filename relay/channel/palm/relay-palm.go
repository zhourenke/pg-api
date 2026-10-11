package palm

import (
	"io"
	"net/http"
	"strings"

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

// https://developers.generativeai.google/api/rest/generativelanguage/models/generateMessage#request-body
// https://developers.generativeai.google/api/rest/generativelanguage/models/generateMessage#response-body

// requestOpenAI2PaLM turns a chat request into the generateMessage body. The
// conversation is prompt.messages with an author per turn, the system prompt goes
// into prompt.context (PaLM keeps it out of the turn list), and the sampling
// parameters keep their own names. PaLM has no max output tokens field, so a
// client's max_tokens cannot be forwarded; it does have topK, which the chat
// request may carry as top_k.
func requestOpenAI2PaLM(request dto.GeneralOpenAIRequest) *PaLMChatRequest {
	palmRequest := PaLMChatRequest{
		Prompt: PaLMPrompt{
			Messages: make([]PaLMChatMessage, 0, len(request.Messages)),
		},
		Temperature: request.Temperature,
	}
	if request.TopP != nil {
		palmRequest.TopP = *request.TopP
	}
	if request.TopK != nil && *request.TopK > 0 {
		palmRequest.TopK = uint(*request.TopK)
	}
	if request.N != nil {
		palmRequest.CandidateCount = *request.N
	}

	var systemPrompts []string
	for _, message := range request.Messages {
		content := message.StringContent()
		switch message.Role {
		case "system":
			systemPrompts = append(systemPrompts, content)
		case "assistant":
			// PaLM names the model's own turns "1" and the user's "0".
			palmRequest.Prompt.Messages = append(palmRequest.Prompt.Messages, PaLMChatMessage{
				Author:  "1",
				Content: content,
			})
		default:
			palmRequest.Prompt.Messages = append(palmRequest.Prompt.Messages, PaLMChatMessage{
				Author:  "0",
				Content: content,
			})
		}
	}
	palmRequest.Prompt.Context = strings.Join(systemPrompts, "\n")
	return &palmRequest
}

func responsePaLM2OpenAI(response *PaLMChatResponse) *dto.OpenAITextResponse {
	fullTextResponse := dto.OpenAITextResponse{
		Choices: make([]dto.OpenAITextResponseChoice, 0, len(response.Candidates)),
	}
	for i, candidate := range response.Candidates {
		choice := dto.OpenAITextResponseChoice{
			Index: i,
			Message: dto.Message{
				Role:    "assistant",
				Content: candidate.Content,
			},
			FinishReason: "stop",
		}
		fullTextResponse.Choices = append(fullTextResponse.Choices, choice)
	}
	return &fullTextResponse
}

func streamResponsePaLM2OpenAI(palmResponse *PaLMChatResponse) *dto.ChatCompletionsStreamResponse {
	var choice dto.ChatCompletionsStreamResponseChoice
	if len(palmResponse.Candidates) > 0 {
		choice.Delta.SetContentString(palmResponse.Candidates[0].Content)
	}
	choice.FinishReason = &constant.FinishReasonStop
	var response dto.ChatCompletionsStreamResponse
	response.Object = "chat.completion.chunk"
	response.Model = "palm2"
	response.Choices = []dto.ChatCompletionsStreamResponseChoice{choice}
	return &response
}

// palmStreamHandler answers a streaming request. generateMessage has no streaming
// form: it returns one object, which is emitted here as the single terminal chat
// chunk (PaLM reports no usage either, so the chunk carries the estimate the
// billing path already uses).
func palmStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	var palmResponse PaLMChatResponse
	if err := common.Unmarshal(responseBody, &palmResponse); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if palmResponse.Error.Code != 0 || len(palmResponse.Candidates) == 0 {
		return nil, types.WithOpenAIError(types.OpenAIError{
			Message: palmResponse.Error.Message,
			Type:    palmResponse.Error.Status,
			Param:   "",
			Code:    palmResponse.Error.Code,
		}, resp.StatusCode)
	}

	responseText := palmResponse.Candidates[0].Content
	usage := service.ResponseText2Usage(c, responseText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	chunk := streamResponsePaLM2OpenAI(&palmResponse)
	chunk.Id = helper.GetResponseID(c)
	chunk.Created = common.GetTimestamp()
	helper.SetEventStreamHeaders(c)
	if info.RelayFormat != types.RelayFormatOpenAI {
		// The converted formats close over this chunk: it already carries the
		// finish reason, and with the usage attached its closing event carries the
		// token counts as well.
		chunk.Usage = usage
		encoded, err := common.Marshal(chunk)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		lastStreamData := string(encoded)
		if err := openai.HandleStreamFormat(c, info, lastStreamData, false, false); err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		info.EnsureClaudeConvertInfo()
		openai.HandleFinalResponse(c, info, lastStreamData, chunk.Id, chunk.Created, info.UpstreamModelName, "", usage, false)
		return usage, nil
	}
	encoded, err := common.Marshal(chunk)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	if err := helper.StringData(c, string(encoded)); err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	helper.Done(c)
	return usage, nil
}

func palmHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	service.CloseResponseBodyGracefully(resp)
	var palmResponse PaLMChatResponse
	err = common.Unmarshal(responseBody, &palmResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if palmResponse.Error.Code != 0 || len(palmResponse.Candidates) == 0 {
		return nil, types.WithOpenAIError(types.OpenAIError{
			Message: palmResponse.Error.Message,
			Type:    palmResponse.Error.Status,
			Param:   "",
			Code:    palmResponse.Error.Code,
		}, resp.StatusCode)
	}
	fullTextResponse := responsePaLM2OpenAI(&palmResponse)
	// The OpenAI path only started reaching this handler once the request was
	// converted, and its response body has to be well formed: an empty object name
	// and a null created field fail typed clients.
	fullTextResponse.Id = helper.GetResponseID(c)
	fullTextResponse.Object = "chat.completion"
	fullTextResponse.Created = common.GetTimestamp()
	fullTextResponse.Model = info.UpstreamModelName
	usage := service.ResponseText2Usage(c, palmResponse.Candidates[0].Content, info.UpstreamModelName, info.GetEstimatePromptTokens())
	fullTextResponse.Usage = *usage
	// A client that asked in another protocol gets that protocol back: the chat
	// body built here is the intermediate it is rendered from, so a PaLM channel
	// can serve Anthropic Messages and generateContent as well.
	var jsonResponse []byte
	if info.RelayFormat != types.RelayFormatOpenAI {
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
	return usage, nil
}
