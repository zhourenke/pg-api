package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/i18n"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"
	"github.com/zhourenke/pg-api/setting/config"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

// The tool price gate has to judge the request the upstream will receive, not
// the client's declarations: converting the request to the selected channel's
// format renames a web search and drops tools that format cannot represent.
// Gating on the client's own format both misses chargeable tools and refuses
// requests whose tool the upstream never got.
func TestToolPriceGateFollowsTheConvertedRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())

	previousPrices := config.GlobalConfig.ExportAllConfigs()["tool_price_setting.prices"]
	t.Cleanup(func() { operation_setting.LoadToolPricesFromJSONString(previousPrices) })
	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	maxTokens := uint(16)
	responsesWebSearch := &dto.OpenAIResponsesRequest{
		Model: "tool-gate-model",
		Input: json.RawMessage(`"search"`),
		Tools: json.RawMessage(`[{"type":"web_search_preview"}]`),
	}
	responsesFileSearch := &dto.OpenAIResponsesRequest{
		Model: "tool-gate-model",
		Input: json.RawMessage(`"search"`),
		Tools: json.RawMessage(`[{"type":"file_search","vector_store_ids":["vs_1"]}]`),
	}
	claudeWebSearch := &dto.ClaudeRequest{
		Model:     "tool-gate-model",
		MaxTokens: &maxTokens,
		Tools:     []any{map[string]any{"type": "web_search_20250305", "name": "web_search"}},
	}
	geminiGoogleSearch := &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "search"}}}},
		Tools:    json.RawMessage(`[{"googleSearch":{}}]`),
	}
	chatWebSearch := &dto.GeneralOpenAIRequest{
		Model:            "tool-gate-model",
		Messages:         []dto.Message{{Role: "user", Content: "search"}},
		WebSearchOptions: &dto.WebSearchOptions{},
	}

	tests := []struct {
		name string
		// newInfo builds the relay info the way its production entry point does,
		// including the tool declarations it seeds for settlement.
		newInfo   func(c *gin.Context) *relaycommon.RelayInfo
		request   any
		target    types.RelayFormat
		prices    string
		wantNames []string
		// wantRefusedTool is the price identity the gate must refuse on, or ""
		// when the gate must let the request through.
		wantRefusedTool string
	}{
		{
			name: "responses web search served by gemini is priced as google_search",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoResponses(c, responsesWebSearch)
			},
			request:         responsesWebSearch,
			target:          types.RelayFormatGemini,
			prices:          `{}`,
			wantNames:       []string{"google_search"},
			wantRefusedTool: "google_search",
		},
		{
			name: "responses web search served by gemini accepts the google_search price",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoResponses(c, responsesWebSearch)
			},
			request:   responsesWebSearch,
			target:    types.RelayFormatGemini,
			prices:    `{"google_search":1}`,
			wantNames: []string{"google_search"},
		},
		{
			name: "a tool gemini cannot represent is dropped and needs no price",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoResponses(c, responsesFileSearch)
			},
			request:   responsesFileSearch,
			target:    types.RelayFormatGemini,
			prices:    `{}`,
			wantNames: nil,
		},
		{
			name: "claude web search served by gemini is priced as google_search",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoClaude(c, claudeWebSearch)
			},
			request:         claudeWebSearch,
			target:          types.RelayFormatGemini,
			prices:          `{}`,
			wantNames:       []string{"google_search"},
			wantRefusedTool: "google_search",
		},
		{
			name: "gemini google search served by claude is priced as web_search",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoGemini(c, geminiGoogleSearch)
			},
			request:         geminiGoogleSearch,
			target:          types.RelayFormatClaude,
			prices:          `{}`,
			wantNames:       []string{"web_search"},
			wantRefusedTool: "web_search",
		},
		{
			name: "without a conversion the client's own format is the upstream namespace",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoResponses(c, responsesWebSearch)
			},
			request:         responsesWebSearch,
			target:          types.RelayFormatOpenAIResponses,
			prices:          `{}`,
			wantNames:       []string{"web_search_preview"},
			wantRefusedTool: "web_search_preview",
		},
		{
			name: "without a conversion a claude web search keeps its own price identity",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoClaude(c, claudeWebSearch)
			},
			request:         claudeWebSearch,
			target:          types.RelayFormatClaude,
			prices:          `{}`,
			wantNames:       []string{"web_search"},
			wantRefusedTool: "web_search",
		},
		{
			// Chat Completions reports no per-call detail, so the declaration is
			// charged as one fixed call under the name the operator UI documents.
			name: "a chat web search served by chat completions is priced as web_search_preview",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoOpenAI(c, chatWebSearch)
			},
			request:         chatWebSearch,
			target:          types.RelayFormatOpenAI,
			prices:          `{}`,
			wantNames:       []string{"web_search_preview"},
			wantRefusedTool: "web_search_preview",
		},
		{
			name: "a claude web search converted to chat completions is priced as web_search_preview",
			newInfo: func(c *gin.Context) *relaycommon.RelayInfo {
				return relaycommon.GenRelayInfoClaude(c, claudeWebSearch)
			},
			request:         claudeWebSearch,
			target:          types.RelayFormatOpenAI,
			prices:          `{}`,
			wantNames:       []string{"web_search_preview"},
			wantRefusedTool: "web_search_preview",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			operation_setting.LoadToolPricesFromJSONString(tt.prices)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := tt.newInfo(c)
			info.OriginModelName = "tool-gate-model"

			_, err := service.ConvertRequest(c, info, tt.target, tt.request)
			require.NoError(t, err)

			assert.Equal(t, tt.wantNames, info.UpstreamBillableToolNames())

			apiErr := helper.CheckBillableToolPrices(c, info)
			if tt.wantRefusedTool == "" {
				assert.Nil(t, apiErr)
				return
			}
			require.NotNil(t, apiErr)
			assert.Equal(t, types.ErrorCodeToolPriceNotConfigured, apiErr.GetErrorCode())
			assert.Equal(t, http.StatusServiceUnavailable, apiErr.StatusCode)
			assert.True(t, types.IsSkipRetryError(apiErr))
			assert.Contains(t, apiErr.Error(), tt.wantRefusedTool)
		})
	}
}
