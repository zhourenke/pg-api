package service

import (
	"context"
	"fmt"

	"github.com/gin-gonic/gin"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/relayconvert"
	"github.com/zhourenke/pg-api/relaykit/types"
)

func init() {
	relayconvert.SetMediaResolver(relayconvert.MediaResolver{
		// relayconvert is gin-free; recover the gin context when the caller
		// passed one so file caching/cleanup keeps working.
		GetBase64Data: func(ctx context.Context, source types.FileSource, reason ...string) (string, string, error) {
			ginCtx, _ := ctx.(*gin.Context)
			return GetBase64Data(ginCtx, source, reason...)
		},
		DecodeBase64FileData: DecodeBase64FileData,
	})
}

// ConvertRequest converts one request for the selected channel and records the
// hosted tool types the conversion wrote upstream, so the request-time tool
// price gate judges the upstream namespace rather than the client's. Every
// production conversion goes through here; see the relay handlers for the gate.
func ConvertRequest(c *gin.Context, info *relaycommon.RelayInfo, target types.RelayFormat, request any) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequest(c, info, target, request)
	if result != nil {
		info.RecordConversionDiagnostics(c, result.Diagnostics)
		recordUpstreamHostedToolTypes(info, result)
	}
	return result, err
}

func ConvertRequestByID(c *gin.Context, info *relaycommon.RelayInfo, converter string, request any) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestByID(c, info, converter, request)
	if result != nil {
		info.RecordConversionDiagnostics(c, result.Diagnostics)
		recordUpstreamHostedToolTypes(info, result)
	}
	return result, err
}

func ConvertRequestVia(c *gin.Context, info *relaycommon.RelayInfo, request any, path ...types.RelayFormat) (*relayconvert.RequestResult, error) {
	result, err := relayconvert.ConvertRequestVia(c, info, request, path...)
	if result != nil {
		info.RecordConversionDiagnostics(c, result.Diagnostics)
		recordUpstreamHostedToolTypes(info, result)
	}
	return result, err
}

// recordUpstreamHostedToolTypes keeps the last conversion's report: an adaptor
// may convert more than once (a chat request bridged to Responses and then to
// the channel's own format), and only the body finally sent upstream decides
// which tool the upstream can charge.
func recordUpstreamHostedToolTypes(info *relaycommon.RelayInfo, result *relayconvert.RequestResult) {
	if info == nil || result == nil || result.HostedToolTypes == nil {
		return
	}
	info.SetUpstreamHostedToolTypes(result.HostedToolTypes)
}

func ClaudeToOpenAIRequest(claudeRequest dto.ClaudeRequest, info *relaycommon.RelayInfo) (*dto.GeneralOpenAIRequest, error) {
	result, err := ConvertRequest(nil, info, types.RelayFormatOpenAI, &claudeRequest)
	if err != nil {
		return nil, err
	}
	openAIRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	return openAIRequest, nil
}

func GeminiToOpenAIRequest(geminiRequest *dto.GeminiChatRequest, info *relaycommon.RelayInfo) (*dto.GeneralOpenAIRequest, error) {
	result, err := ConvertRequest(nil, info, types.RelayFormatOpenAI, geminiRequest)
	if err != nil {
		return nil, err
	}
	openAIRequest, ok := result.Value.(*dto.GeneralOpenAIRequest)
	if !ok {
		return nil, fmt.Errorf("expected OpenAI chat completions request, got %T", result.Value)
	}
	return openAIRequest, nil
}
