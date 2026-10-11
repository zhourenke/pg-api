package cohere

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

func requestOpenAI2Cohere(textRequest dto.GeneralOpenAIRequest) *CohereRequest {
	cohereReq := CohereRequest{
		Model:       textRequest.Model,
		ChatHistory: []ChatHistory{},
		Message:     "",
		Stream:      lo.FromPtrOr(textRequest.Stream, false),
		MaxTokens:   textRequest.GetMaxTokens(),
	}
	if common.CohereSafetySetting != "NONE" {
		cohereReq.SafetyMode = common.CohereSafetySetting
	}
	if cohereReq.MaxTokens == 0 {
		cohereReq.MaxTokens = 4000
	}
	for _, msg := range textRequest.Messages {
		if msg.Role == "user" {
			cohereReq.Message = msg.StringContent()
		} else {
			var role string
			if msg.Role == "assistant" {
				role = "CHATBOT"
			} else if msg.Role == "system" {
				role = "SYSTEM"
			} else {
				role = "USER"
			}
			cohereReq.ChatHistory = append(cohereReq.ChatHistory, ChatHistory{
				Role:    role,
				Message: msg.StringContent(),
			})
		}
	}

	return &cohereReq
}

func requestConvertRerank2Cohere(rerankRequest dto.RerankRequest) *CohereRerankRequest {
	topN := lo.FromPtrOr(rerankRequest.TopN, 1)
	if topN <= 0 {
		topN = 1
	}
	cohereReq := CohereRerankRequest{
		Query:           rerankRequest.Query,
		Documents:       rerankRequest.Documents,
		Model:           rerankRequest.Model,
		TopN:            topN,
		ReturnDocuments: true,
	}
	return &cohereReq
}

func stopReasonCohere2OpenAI(reason string) string {
	switch reason {
	case "COMPLETE":
		return "stop"
	case "MAX_TOKENS":
		return "max_tokens"
	default:
		return reason
	}
}

func cohereStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	responseId := helper.GetResponseID(c)
	createdTime := common.GetTimestamp()
	usage := &dto.Usage{}
	responseText := ""
	scanner := helper.NewStreamScanner(resp.Body)
	scanner.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
		if atEOF && len(data) == 0 {
			return 0, nil, nil
		}
		if i := strings.Index(string(data), "\n"); i >= 0 {
			return i + 1, data[0:i], nil
		}
		if atEOF {
			return len(data), data, nil
		}
		return 0, nil, nil
	})
	dataChan := make(chan string)
	stopChan := make(chan bool)
	go func() {
		for scanner.Scan() {
			data := scanner.Text()
			dataChan <- data
		}
		if err := scanner.Err(); err != nil {
			common.SysLog("error reading stream: " + err.Error())
		}
		stopChan <- true
	}()
	helper.SetEventStreamHeaders(c)
	isFirst := true
	lastStreamData := ""
	c.Stream(func(w io.Writer) bool {
		select {
		case data := <-dataChan:
			if isFirst {
				isFirst = false
				info.FirstResponseTime = time.Now()
			}
			data = strings.TrimSuffix(data, "\r")
			var cohereResp CohereResponse
			err := common.Unmarshal(common.StringToByteSlice(data), &cohereResp)
			if err != nil {
				common.SysLog("error unmarshalling stream response: " + err.Error())
				return true
			}
			var openaiResp dto.ChatCompletionsStreamResponse
			openaiResp.Id = responseId
			openaiResp.Created = createdTime
			openaiResp.Object = "chat.completion.chunk"
			openaiResp.Model = info.UpstreamModelName
			if cohereResp.IsFinished {
				finishReason := stopReasonCohere2OpenAI(cohereResp.FinishReason)
				openaiResp.Choices = []dto.ChatCompletionsStreamResponseChoice{
					{
						Delta:        dto.ChatCompletionsStreamResponseChoiceDelta{},
						Index:        0,
						FinishReason: &finishReason,
					},
				}
				if cohereResp.Response != nil {
					usage.PromptTokens = cohereResp.Response.Meta.BilledUnits.InputTokens
					usage.CompletionTokens = cohereResp.Response.Meta.BilledUnits.OutputTokens
				}
			} else {
				openaiResp.Choices = []dto.ChatCompletionsStreamResponseChoice{
					{
						Delta: dto.ChatCompletionsStreamResponseChoiceDelta{
							Role:    "assistant",
							Content: &cohereResp.Text,
						},
						Index: 0,
					},
				}
				responseText += cohereResp.Text
			}
			jsonStr, err := common.Marshal(openaiResp)
			if err != nil {
				common.SysLog("error marshalling stream response: " + err.Error())
				return true
			}
			lastStreamData = string(jsonStr)
			// A client that asked in another protocol gets that protocol back. The
			// chat chunk built here is the intermediate it is rendered from, so a
			// Cohere stream can serve Anthropic Messages and generateContent too.
			if info.RelayFormat != types.RelayFormatOpenAI {
				if err := openai.HandleStreamFormat(c, info, lastStreamData, false, false); err != nil {
					common.SysLog("error converting stream response: " + err.Error())
				}
				return true
			}
			c.Render(-1, common.CustomEvent{Data: "data: " + lastStreamData})
			return true
		case <-stopChan:
			if info.RelayFormat != types.RelayFormatOpenAI {
				// The converted formats end with their own closing event instead of
				// a chat [DONE]; the Claude path needs its per-stream state.
				info.EnsureClaudeConvertInfo()
				openai.HandleFinalResponse(c, info, lastStreamData, responseId, createdTime, info.UpstreamModelName, "", usage, false)
				return false
			}
			c.Render(-1, common.CustomEvent{Data: "data: [DONE]"})
			return false
		}
	})
	if usage.PromptTokens == 0 {
		usage = service.ResponseText2Usage(c, responseText, info.UpstreamModelName, info.GetEstimatePromptTokens())
	}
	return usage, nil
}

func cohereHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	createdTime := common.GetTimestamp()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.CloseResponseBodyGracefully(resp)
	var cohereResp CohereResponseResult
	err = common.Unmarshal(responseBody, &cohereResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	usage := dto.Usage{}
	usage.PromptTokens = cohereResp.Meta.BilledUnits.InputTokens
	usage.CompletionTokens = cohereResp.Meta.BilledUnits.OutputTokens
	usage.TotalTokens = cohereResp.Meta.BilledUnits.InputTokens + cohereResp.Meta.BilledUnits.OutputTokens

	var openaiResp dto.OpenAITextResponse
	openaiResp.Id = cohereResp.ResponseId
	openaiResp.Created = createdTime
	openaiResp.Object = "chat.completion"
	openaiResp.Model = info.UpstreamModelName
	openaiResp.Usage = usage

	openaiResp.Choices = []dto.OpenAITextResponseChoice{
		{
			Index:        0,
			Message:      dto.Message{Content: cohereResp.Text, Role: "assistant"},
			FinishReason: stopReasonCohere2OpenAI(cohereResp.FinishReason),
		},
	}

	responseBody, err = common.Marshal(openaiResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	// A client that asked in another protocol gets that protocol back: the chat
	// body built here is the intermediate it is rendered from, so a Cohere channel
	// can serve Anthropic Messages and generateContent as well.
	if info.RelayFormat != types.RelayFormatOpenAI {
		convertResult, err := service.ConvertResponse(c, info, info.RelayFormat, &openaiResp)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
		responseBody, err = common.Marshal(convertResult.Value)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = c.Writer.Write(responseBody)
	return &usage, nil
}

func cohereRerankHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*dto.Usage, *types.NewAPIError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	service.CloseResponseBodyGracefully(resp)
	var cohereResp CohereRerankResponseResult
	err = common.Unmarshal(responseBody, &cohereResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	usage := dto.Usage{}
	if cohereResp.Meta.BilledUnits.InputTokens == 0 {
		usage.PromptTokens = info.GetEstimatePromptTokens()
		usage.CompletionTokens = 0
		usage.TotalTokens = info.GetEstimatePromptTokens()
	} else {
		usage.PromptTokens = cohereResp.Meta.BilledUnits.InputTokens
		usage.CompletionTokens = cohereResp.Meta.BilledUnits.OutputTokens
		usage.TotalTokens = cohereResp.Meta.BilledUnits.InputTokens + cohereResp.Meta.BilledUnits.OutputTokens
	}

	var rerankResp dto.RerankResponse
	rerankResp.Results = cohereResp.Results
	rerankResp.Usage = usage

	jsonResponse, err := common.Marshal(rerankResp)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody)
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	return &usage, nil
}
