package openai

import (
	"fmt"
	"strings"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/logger"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	relayconstant "github.com/zhourenke/pg-api/relay/constant"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/relayconvert"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
)

// 辅助函数
func HandleStreamFormat(c *gin.Context, info *relaycommon.RelayInfo, data string, forceFormat bool, thinkToContent bool) error {
	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		info.SendResponseCount++
		return sendStreamData(c, info, data, forceFormat, thinkToContent)
	case types.RelayFormatClaude:
		info.SendResponseCount++
		return handleClaudeFormat(c, data, info)
	case types.RelayFormatGemini:
		// The stateful relaykit path owns its chunk counter so multi-hop and
		// direct conversions observe the same stream state semantics.
		return handleGeminiFormat(c, data, info)
	}
	return nil
}

func handleClaudeFormat(c *gin.Context, data string, info *relaycommon.RelayInfo) error {
	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(data), &streamResponse); err != nil {
		return err
	}

	if streamResponse.Usage != nil {
		info.EnsureClaudeConvertInfo().Usage = streamResponse.Usage
	}
	result, err := service.ConvertStreamResponse(c, info, types.RelayFormatClaude, &streamResponse)
	if err != nil {
		return err
	}
	claudeResponses, ok := result.Value.([]*dto.ClaudeResponse)
	if !ok {
		return fmt.Errorf("expected Claude stream responses, got %T", result.Value)
	}
	for _, resp := range claudeResponses {
		helper.ClaudeData(c, *resp)
	}
	return nil
}

func handleGeminiFormat(c *gin.Context, data string, info *relaycommon.RelayInfo) error {
	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(data), &streamResponse); err != nil {
		logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
		return err
	}

	state, err := chatToGeminiStreamState(info, &streamResponse)
	if err != nil {
		return err
	}
	results, err := service.ConvertStreamResponseChunk(c, info, state, &streamResponse)
	if err != nil {
		return err
	}
	return sendGeminiStreamResults(c, results)
}

func chatToGeminiStreamState(info *relaycommon.RelayInfo, streamResponse *dto.ChatCompletionsStreamResponse) (*relayconvert.ResponseStreamState, error) {
	if info != nil && info.ChatToGeminiStreamState != nil {
		state, ok := info.ChatToGeminiStreamState.(*relayconvert.ResponseStreamState)
		if !ok || state == nil {
			return nil, fmt.Errorf("invalid Chat-to-Gemini stream state %T", info.ChatToGeminiStreamState)
		}
		return state, nil
	}

	state, err := relayconvert.NewResponseStreamState(types.RelayFormatOpenAI, types.RelayFormatGemini, relayconvert.ResponseStreamOptions{
		ID:      streamResponse.Id,
		Model:   streamResponse.Model,
		Created: streamResponse.Created,
	})
	if err != nil {
		return nil, err
	}
	if info != nil {
		info.ChatToGeminiStreamState = state
	}
	return state, nil
}

func sendGeminiStreamResults(c *gin.Context, results []relayconvert.ResponseResult) error {
	for _, result := range results {
		geminiResponse, ok := result.Value.(*dto.GeminiChatResponse)
		if !ok {
			return fmt.Errorf("expected Gemini stream response, got %T", result.Value)
		}
		if geminiResponse == nil {
			continue
		}
		data, err := common.Marshal(geminiResponse)
		if err != nil {
			logger.LogError(c, "failed to marshal gemini response: "+err.Error())
			return err
		}
		c.Render(-1, common.CustomEvent{Data: "data: " + string(data)})
		_ = helper.FlushWriter(c)
	}
	return nil
}

func ProcessStreamResponse(streamResponse dto.ChatCompletionsStreamResponse, responseTextBuilder *strings.Builder, toolCount *int) error {
	for _, choice := range streamResponse.Choices {
		responseTextBuilder.WriteString(choice.Delta.GetContentString())
		responseTextBuilder.WriteString(choice.Delta.GetReasoningContent())
		if choice.Delta.ToolCalls != nil {
			if len(choice.Delta.ToolCalls) > *toolCount {
				*toolCount = len(choice.Delta.ToolCalls)
			}
			for _, tool := range choice.Delta.ToolCalls {
				responseTextBuilder.WriteString(tool.Function.Name)
				responseTextBuilder.WriteString(tool.Function.Arguments)
			}
		}
	}
	return nil
}

// processTokenData accumulates the answer text this request falls back to billing
// when the upstream reports no usage, and observes the model it answered with.
// Every streaming body this handler serves is a chat chunk, including the Claude
// and Gemini client formats, which are converted from one; only the legacy
// completions mode differs. The request's own relay mode therefore cannot decide
// the chunk shape: /v1/messages has no relay mode of its own and the Gemini paths
// set their own, so both would otherwise bill a completion of zero tokens.
func processTokenData(info *relaycommon.RelayInfo, data string, responseTextBuilder *strings.Builder, toolCount *int) error {
	if info.RelayMode == relayconstant.RelayModeCompletions {
		var streamResponse dto.CompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			return err
		}
		processCompletionsStreamResponse(streamResponse, responseTextBuilder)
		return nil
	}

	var streamResponse dto.ChatCompletionsStreamResponse
	if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
		return err
	}
	info.ObserveResponseModel(streamResponse.Model)
	return ProcessStreamResponse(streamResponse, responseTextBuilder, toolCount)
}

func processCompletionsStreamResponse(streamResponse dto.CompletionsStreamResponse, responseTextBuilder *strings.Builder) {
	for _, choice := range streamResponse.Choices {
		responseTextBuilder.WriteString(choice.Text)
	}
}

func handleLastResponse(lastStreamData string, responseId *string, createAt *int64,
	systemFingerprint *string, model *string, usage **dto.Usage,
	containStreamUsage *bool, info *relaycommon.RelayInfo,
	shouldSendLastResp *bool) error {

	var lastStreamResponse dto.ChatCompletionsStreamResponse
	if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &lastStreamResponse); err != nil {
		return err
	}

	*responseId = lastStreamResponse.Id
	*createAt = lastStreamResponse.Created
	*systemFingerprint = lastStreamResponse.GetSystemFingerprint()
	*model = lastStreamResponse.Model

	if service.ValidUsage(lastStreamResponse.Usage) {
		*containStreamUsage = true
		*usage = dto.MergeUsageNonZero(*usage, lastStreamResponse.Usage)
		if !info.ShouldIncludeUsage {
			*shouldSendLastResp = lo.SomeBy(lastStreamResponse.Choices, func(choice dto.ChatCompletionsStreamResponseChoice) bool {
				return choice.Delta.GetContentString() != "" || choice.Delta.GetReasoningContent() != ""
			})
		}
	}

	return nil
}

func HandleFinalResponse(c *gin.Context, info *relaycommon.RelayInfo, lastStreamData string,
	responseId string, createAt int64, model string, systemFingerprint string,
	usage *dto.Usage, containStreamUsage bool) {

	// The converted formats open the client's protocol and emit its closing event
	// by converting one terminal chat chunk. A stream that carried no data frame at
	// all has none to convert, which would leave the client with an empty stream
	// and two errors in the log, so it closes over an empty terminal chunk instead.
	if lastStreamData == "" && (info.RelayFormat == types.RelayFormatClaude || info.RelayFormat == types.RelayFormatGemini) {
		stopReason := "stop"
		encoded, err := common.Marshal(dto.ChatCompletionsStreamResponse{
			Choices: []dto.ChatCompletionsStreamResponseChoice{{Index: 0, FinishReason: &stopReason}},
		})
		if err != nil {
			common.SysLog("error marshalling the empty terminal chunk: " + err.Error())
			return
		}
		lastStreamData = string(encoded)
	}

	switch info.RelayFormat {
	case types.RelayFormatOpenAI:
		if info.ShouldIncludeUsage && !containStreamUsage {
			response := helper.GenerateFinalUsageResponse(responseId, createAt, model, *usage)
			response.SetSystemFingerprint(systemFingerprint)
			helper.ObjectData(c, response)
		}
		helper.Done(c)

	case types.RelayFormatClaude:
		var streamResponse dto.ChatCompletionsStreamResponse
		if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &streamResponse); err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			return
		}

		// The converter opens the message on the chunk that brings its chunk
		// counter to one. A caller that holds its terminal chunk back instead of
		// streaming it renders that chunk here, so this pass counts it as well;
		// without that an answer of exactly one chunk would open the message twice.
		// The same call creates the per-stream state that a stream without any
		// chunk would otherwise leave nil.
		info.EnsureClaudeConvertInfo()
		info.IncrSendResponseCount()

		info.ClaudeConvertInfo.Usage = usage

		result, err := service.ConvertStreamResponse(c, info, types.RelayFormatClaude, &streamResponse)
		if err != nil {
			common.SysLog("error converting Claude stream response: " + err.Error())
			return
		}
		claudeResponses, ok := result.Value.([]*dto.ClaudeResponse)
		if !ok {
			common.SysLog(fmt.Sprintf("expected Claude stream responses, got %T", result.Value))
			return
		}
		for _, resp := range claudeResponses {
			_ = helper.ClaudeData(c, *resp)
		}
		info.ClaudeConvertInfo.Done = true

	case types.RelayFormatGemini:
		var streamResponse dto.ChatCompletionsStreamResponse
		if err := common.Unmarshal(common.StringToByteSlice(lastStreamData), &streamResponse); err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			return
		}

		state, err := chatToGeminiStreamState(info, &streamResponse)
		if err != nil {
			common.SysLog("error creating Gemini stream state: " + err.Error())
			return
		}
		state.SetUsage(usage)

		results, err := service.ConvertStreamResponseChunk(c, info, state, &streamResponse)
		if err != nil {
			common.SysLog("error converting final Gemini stream response: " + err.Error())
			return
		}
		if err := sendGeminiStreamResults(c, results); err != nil {
			common.SysLog("error sending final Gemini stream response: " + err.Error())
			return
		}

		results, err = service.FinalizeStreamResponse(c, info, state)
		if err != nil {
			common.SysLog("error finalizing Gemini stream response: " + err.Error())
			return
		}
		if err := sendGeminiStreamResults(c, results); err != nil {
			common.SysLog("error sending finalized Gemini stream response: " + err.Error())
		}
	}
}

func sendResponsesStreamData(c *gin.Context, streamResponse dto.ResponsesStreamResponse, data string) {
	if data == "" {
		return
	}
	_ = helper.ResponseChunkData(c, streamResponse, data)
}
