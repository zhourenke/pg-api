package relayconvert

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/relayconvert/convmeta"
	kitutil "github.com/zhourenke/pg-api/relaykit/relayconvert/kitutil"
	"github.com/zhourenke/pg-api/relaykit/types"
)

func TestConvertRequestDefaultPolicyAllowsGeminiCodeExecution(t *testing.T) {
	t.Parallel()

	tools, err := kitutil.Marshal([]map[string]any{{"codeExecution": map[string]any{}}})
	require.NoError(t, err)
	req := &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{Role: "user", Parts: []dto.GeminiPart{{Text: "run this"}}},
		},
		Tools: tools,
	}

	result, err := ConvertRequest(nil, nil, types.RelayFormatOpenAI, req)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.IsType(t, &dto.GeneralOpenAIRequest{}, result.Value)
	assert.True(t, hasConversionDiagnosticCode(result.Diagnostics, "unsupported_hosted_tool"))
}

func TestConvertResponseStrictPolicyStillSucceedsOnContinuationLoss(t *testing.T) {
	t.Parallel()

	text := "hello"
	resp := &dto.ClaudeResponse{
		Id:         "msg_1",
		Type:       "message",
		Role:       "assistant",
		Model:      "claude-test",
		StopReason: "pause_turn",
		Content: []dto.ClaudeMediaMessage{
			{Type: "redacted_thinking", Data: "secret"},
			{Type: "text", Text: &text},
		},
	}
	info := &convmeta.Values{
		Options: &convmeta.Options{ToolLossPolicy: types.ConversionLossPolicyStrict},
	}

	result, err := ConvertResponse(nil, info, types.RelayFormatOpenAI, resp)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.IsType(t, &dto.OpenAITextResponse{}, result.Value)
	assert.True(t, hasConversionDiagnosticCode(result.Diagnostics, "continuation_state_lost"))
}

func TestConvertRequestSafePolicyReturnsConversionLossError(t *testing.T) {
	t.Parallel()

	tools, err := kitutil.Marshal([]map[string]any{{"codeExecution": map[string]any{}}})
	require.NoError(t, err)
	req := &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{Role: "user", Parts: []dto.GeminiPart{{Text: "run this"}}},
		},
		Tools: tools,
	}
	info := &convmeta.Values{
		Options: &convmeta.Options{ToolLossPolicy: types.ConversionLossPolicySafe},
	}

	result, err := ConvertRequest(nil, info, types.RelayFormatOpenAI, req)
	require.Error(t, err)
	var loss *types.ConversionLossError
	require.ErrorAs(t, err, &loss)
	require.NotEmpty(t, loss.Diagnostics)
	require.NotNil(t, result)
	assert.True(t, hasConversionDiagnosticCode(loss.Diagnostics, "unsupported_hosted_tool"))
	assert.True(t, hasConversionDiagnosticCode(result.Diagnostics, "unsupported_hosted_tool"))
}

func hasConversionDiagnosticCode(diagnostics []types.ConversionDiagnostic, code string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == code {
			return true
		}
	}
	return false
}

// A conversion reports the hosted tool types it actually wrote into the upstream
// request, in the upstream's own spelling. That list — not the source request's
// declarations — is what the gateway may charge for, so it must follow the
// rename and drop decisions, and stay nil when no conversion happened at all.
func TestConvertRequestReportsHostedToolsWrittenUpstream(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		source  types.RelayFormat
		request any
		target  types.RelayFormat
		want    []string
	}{
		{
			name:   "responses web search served by gemini",
			source: types.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{
				Model: "gpt-4o",
				Input: json.RawMessage(`"search"`),
				Tools: json.RawMessage(`[{"type":"web_search_preview"}]`),
			},
			target: types.RelayFormatGemini,
			want:   []string{"googleSearch"},
		},
		{
			name:   "gemini drops a file search it cannot represent",
			source: types.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{
				Model: "gpt-4o",
				Input: json.RawMessage(`"search"`),
				Tools: json.RawMessage(`[{"type":"file_search","vector_store_ids":["vs_1"]}]`),
			},
			target: types.RelayFormatGemini,
			want:   []string{},
		},
		{
			name:   "responses web search served by claude",
			source: types.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{
				Model: "gpt-4o",
				Input: json.RawMessage(`"search"`),
				Tools: json.RawMessage(`[{"type":"web_search_preview"}]`),
			},
			target: types.RelayFormatClaude,
			want:   []string{"web_search"},
		},
		{
			name:   "chat completions cannot carry a hosted tool at all",
			source: types.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{
				Model: "gpt-4o",
				Input: json.RawMessage(`"search"`),
				Tools: json.RawMessage(`[{"type":"file_search","vector_store_ids":["vs_1"]}]`),
			},
			target: types.RelayFormatOpenAI,
			want:   []string{},
		},
		{
			name:   "claude web search served by gemini",
			source: types.RelayFormatClaude,
			request: &dto.ClaudeRequest{
				Model: "claude-test",
				Tools: []any{map[string]any{"type": "web_search_20250305", "name": "web_search"}},
			},
			target: types.RelayFormatGemini,
			want:   []string{"googleSearch"},
		},
		{
			name:   "gemini google search served by claude",
			source: types.RelayFormatGemini,
			request: &dto.GeminiChatRequest{
				Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "search"}}}},
				Tools:    json.RawMessage(`[{"googleSearch":{}}]`),
			},
			target: types.RelayFormatClaude,
			want:   []string{"web_search"},
		},
		{
			name:   "no conversion leaves the list nil",
			source: types.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{
				Model: "gpt-4o",
				Input: json.RawMessage(`"search"`),
				Tools: json.RawMessage(`[{"type":"web_search_preview"}]`),
			},
			target: types.RelayFormatOpenAIResponses,
			want:   nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// A Claude target needs a usable max_tokens; production supplies it
			// from the channel's Claude settings.
			info := &convmeta.Values{Options: &convmeta.Options{
				Claude: convmeta.ClaudeOptions{DefaultMaxTokens: func(string) int { return 16 }},
			}}
			result, err := ConvertRequest(nil, info, tt.target, tt.request)
			require.NoError(t, err)
			require.NotNil(t, result)
			require.Equal(t, tt.source, result.From)
			assert.Equal(t, tt.want, result.HostedToolTypes)
		})
	}
}
