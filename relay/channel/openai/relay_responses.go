package openai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/logger"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	info.ObserveResponseModel(responsesResponse.Model)
	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := &dto.Usage{}
	service.ApplyResponsesUsage(usage, responsesResponse.Usage)
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	if !relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status) {
		for i := range responsesResponse.Output {
			idx := i
			imageCounter.Observe(&responsesResponse.Output[i], &idx)
		}
	}
	imageCounter.Commit(info)

	return usage, nil
}

type pendingResponsesStreamEvent struct {
	streamResponse dto.ResponsesStreamResponse
	data           string
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid response or response body")
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)
	var pendingEvents []pendingResponsesStreamEvent
	flushedContent := false

	flushPending := func() {
		if flushedContent {
			return
		}
		flushedContent = true
		for _, p := range pendingEvents {
			sendResponsesStreamData(c, p.streamResponse, p.data)
		}
		pendingEvents = nil
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, "failed to unmarshal stream response: "+err.Error())
			sr.Error(err)
			return
		}
		if streamResponse.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", streamResponse.Response.CreatedAt))
		}

		isInitialLifecycle := streamResponse.Type == "response.created" || streamResponse.Type == "response.in_progress"
		if !flushedContent && isInitialLifecycle {
			pendingEvents = append(pendingEvents, pendingResponsesStreamEvent{
				streamResponse: streamResponse,
				data:           data,
			})
		} else {
			flushPending()
			sendResponsesStreamData(c, streamResponse, data)
		}
		accumulator.Observe(&streamResponse)
	})

	common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, info.StreamStatus)
	info.StreamStatus.RequireTerminal()

	// If the stream ended unexpectedly:
	if info.StreamStatus != nil && (!info.StreamStatus.IsNormalEnd() || info.StreamStatus.ResponseOutcome() == "") {
		// If nothing was written to the client yet (e.g. only initial lifecycle events were buffered),
		// return an API error so the relay layer can failover to retry the next available channel.
		if !flushedContent || !c.Writer.Written() {
			return nil, types.NewOpenAIError(
				fmt.Errorf("upstream responses stream ended unexpectedly before content: %s", info.StreamStatus.Summary()),
				types.ErrorCodeBadResponseBody,
				http.StatusInternalServerError,
			)
		}
		// If content was already written to the client, we cannot failover anymore.
		// Emit terminal error and response.failed events so the client does not hang.
		if info.StreamStatus.EndReason != relaycommon.StreamEndReasonClientGone {
			sendResponsesStreamFailure(c, info, fmt.Errorf("upstream responses stream ended unexpectedly: %s", info.StreamStatus.Summary()))
		}
	}

	return accumulator.Finish(), nil
}

func sendResponsesStreamFailure(c *gin.Context, info *relaycommon.RelayInfo, err error) {
	if c == nil || err == nil || (c.Request != nil && c.Request.Context().Err() != nil) {
		return
	}
	responseID := helper.GetResponseID(c)
	errMsg := err.Error()

	// 1. Send error event
	errResp := dto.ResponsesStreamResponse{
		Type:    "error",
		Code:    "server_error",
		Message: errMsg,
	}
	if errData, marshalErr := common.Marshal(errResp); marshalErr == nil {
		_ = helper.ResponseChunkData(c, errResp, string(errData))
	}

	// 2. Send response.failed event
	failedResp := dto.ResponsesStreamResponse{
		Type: "response.failed",
		Response: &dto.OpenAIResponsesResponse{
			ID:     responseID,
			Object: "response",
			Status: json.RawMessage(`"failed"`),
			Error: map[string]any{
				"code":    "server_error",
				"message": errMsg,
			},
			Model: info.UpstreamModelName,
		},
	}
	if failedData, marshalErr := common.Marshal(failedResp); marshalErr == nil {
		_ = helper.ResponseChunkData(c, failedResp, string(failedData))
	}
	if info != nil && info.StreamStatus != nil {
		info.StreamStatus.MarkFailed("server_error", "upstream_error", http.StatusInternalServerError)
	}
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}
