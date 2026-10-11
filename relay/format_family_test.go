package relay

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	relayconstant "github.com/zhourenke/pg-api/relay/constant"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
)

// An OpenAI-compatible channel serves the Anthropic Messages and the Gemini
// generateContent formats the way it serves the OpenAI format: the request is
// converted to a chat request, the channel's own OpenAI shaping is applied to it,
// and it goes to the channel's chat endpoint. These channels have no upstream
// dialect of their own for those two formats, so the three pieces have to agree,
// and the capability table (checked by capabilities_test.go) only covers the
// first of them.
func TestGeminiFamilyConvertsRequestsToTheChatEndpoint(t *testing.T) {
	tests := []struct {
		name        string
		apiType     int
		channelType int
		wantURL     string
		// The channel's own OpenAI shaping clamps top_p, which the shared
		// conversion leaves at the value the client sent. Asserting the clamp
		// proves the converted body goes through the channel's converter and not
		// through the plain OpenAI one.
		wantShapedTopP bool
	}{
		{"ali", constant.APITypeAli, constant.ChannelTypeAli, "https://upstream.example.com/compatible-mode/v1/chat/completions", true},
		{"baidu_v2", constant.APITypeBaiduV2, constant.ChannelTypeBaiduV2, "https://upstream.example.com/v2/chat/completions", false},
		{"cloudflare", constant.APITypeCloudflare, constant.ChannelCloudflare, "https://upstream.example.com/client/v4/accounts/account-1/ai/v1/chat/completions", false},
		{"deepseek", constant.APITypeDeepSeek, constant.ChannelTypeDeepSeek, "https://upstream.example.com/v1/chat/completions", false},
		{"mistral", constant.APITypeMistral, constant.ChannelTypeMistral, "https://upstream.example.com/v1/chat/completions", false},
		{"moonshot", constant.APITypeMoonshot, constant.ChannelTypeMoonshot, "https://upstream.example.com/v1/chat/completions", false},
		{"perplexity", constant.APITypePerplexity, constant.ChannelTypePerplexity, "https://upstream.example.com/chat/completions", true},
		{"siliconflow", constant.APITypeSiliconFlow, constant.ChannelTypeSiliconFlow, "https://upstream.example.com/v1/chat/completions", false},
		{"submodel", constant.APITypeSubmodel, constant.ChannelTypeSubmodel, "https://upstream.example.com/v1/chat/completions", false},
		{"xai", constant.APITypeXai, constant.ChannelTypeXai, "https://upstream.example.com/v1/chat/completions", false},
		{"zhipu_4v", constant.APITypeZhipuV4, constant.ChannelTypeZhipu_v4, "https://upstream.example.com/api/paas/v4/chat/completions", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adaptor := GetAdaptor(tt.apiType)
			require.NotNil(t, adaptor)

			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			info := geminiRelayInfo(tt.channelType)

			requestURL, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, requestURL)

			converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			require.NoError(t, err)

			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			assert.Equal(t, "gemini-2.5-flash", info.UpstreamModelName)
			assert.Equal(t, "gemini-2.5-flash", gjson.GetBytes(encoded, "model").String(), string(encoded))
			assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String())
			// Mistral re-serializes a single text part as a media-content array,
			// which is how it sends every chat request upstream.
			assert.Contains(t, gjson.GetBytes(encoded, "messages.0.content").String(), "hello")
			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach an OpenAI upstream: %s", encoded)

			topP := gjson.GetBytes(encoded, "top_p").Float()
			if tt.wantShapedTopP {
				assert.Equal(t, 0.99, topP, string(encoded))
			} else {
				assert.Equal(t, 1.5, topP, string(encoded))
			}
		})
	}
}

func TestClaudeFamilyConvertsRequestsToTheChatEndpoint(t *testing.T) {
	tests := []struct {
		name        string
		apiType     int
		channelType int
		wantURL     string
		model       string
		// The top_p the client sent is 1; a channel whose own shaping clamps it
		// into the open interval sends 0.99 instead. Either value proves the
		// converted request went through the channel's ConvertOpenAIRequest and
		// not through openai.Adaptor's.
		wantTopP float64
		// A channel-side shaping effect only that channel's own
		// ConvertOpenAIRequest produces.
		assertShaped func(t *testing.T, encoded []byte)
	}{
		{
			name: "ali", apiType: constant.APITypeAli, channelType: constant.ChannelTypeAli,
			wantURL: "https://upstream.example.com/compatible-mode/v1/chat/completions",
			model:   "gemini-2.5-flash", wantTopP: 0.99,
		},
		{
			name: "baidu_v2", apiType: constant.APITypeBaiduV2, channelType: constant.ChannelTypeBaiduV2,
			wantURL: "https://upstream.example.com/v2/chat/completions",
			model:   "gemini-2.5-flash-search", wantTopP: 1,
			assertShaped: func(t *testing.T, encoded []byte) {
				// Baidu V2's shaping turns the -search model suffix into a request field.
				assert.Equal(t, "gemini-2.5-flash", gjson.GetBytes(encoded, "model").String(), string(encoded))
				assert.True(t, gjson.GetBytes(encoded, "web_search.enable").Bool(), string(encoded))
			},
		},
		{
			name: "cloudflare", apiType: constant.APITypeCloudflare, channelType: constant.ChannelCloudflare,
			wantURL: "https://upstream.example.com/client/v4/accounts/account-1/ai/v1/chat/completions",
			model:   "llama-3.3-70b", wantTopP: 1,
		},
		{
			name: "mistral", apiType: constant.APITypeMistral, channelType: constant.ChannelTypeMistral,
			wantURL: "https://upstream.example.com/v1/chat/completions",
			model:   "mistral-large-latest", wantTopP: 1,
			assertShaped: func(t *testing.T, encoded []byte) {
				// Mistral accepts only 9 alphanumeric characters as a tool-call
				// id, so its shaping rewrites the Anthropic one.
				id := gjson.GetBytes(encoded, "messages.2.tool_calls.0.id").String()
				assert.Regexp(t, regexp.MustCompile(`^[a-zA-Z0-9]{9}$`), id, string(encoded))
			},
		},
		{
			name: "perplexity", apiType: constant.APITypePerplexity, channelType: constant.ChannelTypePerplexity,
			wantURL: "https://upstream.example.com/chat/completions",
			model:   "sonar-pro", wantTopP: 0.99,
		},
		{
			name: "siliconflow", apiType: constant.APITypeSiliconFlow, channelType: constant.ChannelTypeSiliconFlow,
			wantURL: "https://upstream.example.com/v1/chat/completions",
			model:   "Qwen/Qwen3-8B", wantTopP: 1,
		},
		{
			name: "submodel", apiType: constant.APITypeSubmodel, channelType: constant.ChannelTypeSubmodel,
			wantURL: "https://upstream.example.com/v1/chat/completions",
			model:   "deepseek-v3", wantTopP: 1,
		},
		{
			name: "xai", apiType: constant.APITypeXai, channelType: constant.ChannelTypeXai,
			wantURL: "https://upstream.example.com/v1/chat/completions",
			model:   "grok-3-search", wantTopP: 1,
			assertShaped: func(t *testing.T, encoded []byte) {
				// xAI's shaping turns the -search model suffix into a request field.
				assert.Equal(t, "grok-3", gjson.GetBytes(encoded, "model").String(), string(encoded))
				assert.Equal(t, "on", gjson.GetBytes(encoded, "search_parameters.mode").String(), string(encoded))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adaptor := GetAdaptor(tt.apiType)
			require.NotNil(t, adaptor)

			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			info := claudeRelayInfo(tt.channelType, tt.model)

			requestURL, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, requestURL)

			converted, err := adaptor.ConvertClaudeRequest(c, info, claudeRequest(tt.model))
			require.NoError(t, err)

			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			// Anthropic carries the system prompt as a top-level field; a chat
			// upstream carries it as the first message. Its absence proves the
			// Anthropic shape did not reach the upstream.
			assert.False(t, gjson.GetBytes(encoded, "system").Exists(), "the Anthropic shape must not reach an OpenAI upstream: %s", encoded)
			assert.Equal(t, "system", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
			assert.Contains(t, gjson.GetBytes(encoded, "messages.0.content").String(), "you are brief")
			assert.Equal(t, uint64(64), gjson.GetBytes(encoded, "max_tokens").Uint(), string(encoded))
			assert.Equal(t, tt.wantTopP, gjson.GetBytes(encoded, "top_p").Float(), string(encoded))

			if tt.assertShaped != nil {
				tt.assertShaped(t, encoded)
			}
		})
	}
}

// A streaming request through a channel that supports stream_options must ask the
// upstream for usage: the client's protocol reports usage in its own shape and
// never carries the field itself, and the channel's own ConvertOpenAIRequest does
// not add it.
func TestClaudeFamilyKeepsStreamOptionsForChannelsThatSupportThem(t *testing.T) {
	tests := []struct {
		name         string
		apiType      int
		channelType  int
		wantIncluded bool
	}{
		{"ali", constant.APITypeAli, constant.ChannelTypeAli, true},
		{"baidu_v2", constant.APITypeBaiduV2, constant.ChannelTypeBaiduV2, true},
		{"siliconflow", constant.APITypeSiliconFlow, constant.ChannelTypeSiliconFlow, true},
		// Not in streamSupportedChannels, so the field is not sent.
		{"perplexity", constant.APITypePerplexity, constant.ChannelTypePerplexity, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			info := claudeRelayInfo(tt.channelType, "test-model")
			info.IsStream = true
			info.SupportStreamOptions = true

			converted, err := GetAdaptor(tt.apiType).ConvertClaudeRequest(c, info, claudeRequest("test-model"))
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)

			included := gjson.GetBytes(encoded, "stream_options.include_usage").Bool()
			assert.Equal(t, tt.wantIncluded, included, string(encoded))
		})
	}
}

// The client asked in one protocol and gets that protocol back. A channel whose
// own response handler writes the OpenAI shape has to leave these formats to the
// OpenAI adaptor, which is the only handler that renders a chat body in the
// client's language.
func TestGeminiFamilyRendersResponsesInTheGeminiShape(t *testing.T) {
	const upstreamBody = `{"id":"chatcmpl-1","object":"chat.completion","model":"gemini-2.5-flash",` +
		`"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`

	tests := []struct {
		name        string
		apiType     int
		channelType int
	}{
		{"xai", constant.APITypeXai, constant.ChannelTypeXai},
		{"cloudflare", constant.APITypeCloudflare, constant.ChannelCloudflare},
		{"moonshot", constant.APITypeMoonshot, constant.ChannelTypeMoonshot},
		{"perplexity", constant.APITypePerplexity, constant.ChannelTypePerplexity},
		{"submodel", constant.APITypeSubmodel, constant.ChannelTypeSubmodel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			info := geminiRelayInfo(tt.channelType)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(tt.apiType).DoResponse(c, resp, info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
			assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "a Gemini client must not receive the chat shape: %s", body)
		})
	}
}

func TestClaudeFamilyRendersResponsesInTheClaudeShape(t *testing.T) {
	const upstreamBody = `{"id":"chatcmpl-1","object":"chat.completion","model":"grok-3",` +
		`"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`

	tests := []struct {
		name        string
		apiType     int
		channelType int
	}{
		{"xai", constant.APITypeXai, constant.ChannelTypeXai},
		{"cloudflare", constant.APITypeCloudflare, constant.ChannelCloudflare},
		// Mistral's own handler already routes through the OpenAI rendering.
		{"mistral", constant.APITypeMistral, constant.ChannelTypeMistral},
		{"submodel", constant.APITypeSubmodel, constant.ChannelTypeSubmodel},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			info := claudeRelayInfo(tt.channelType, "grok-3")
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(tt.apiType).DoResponse(c, resp, info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
			assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
			assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "a Claude client must not receive the chat shape: %s", body)
		})
	}
}

func geminiRelayInfo(channelType int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatGemini,
		RelayMode:       relayconstant.RelayModeGemini,
		RequestURLPath:  "/v1beta/models/gemini-2.5-flash:generateContent",
		OriginModelName: "gemini-2.5-flash",
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			ChannelBaseUrl:    "https://upstream.example.com",
			UpstreamModelName: "gemini-2.5-flash",
			ApiVersion:        "account-1",
		},
	}
}

func geminiRequest() *dto.GeminiChatRequest {
	return &dto.GeminiChatRequest{
		Contents: []dto.GeminiChatContent{
			{Role: "user", Parts: []dto.GeminiPart{{Text: "hello"}}},
		},
		GenerationConfig: dto.GeminiChatGenerationConfig{TopP: common.GetPointer(1.5)},
	}
}

// A Claude request carries a top-level system prompt and no relay mode: the path
// (/v1/messages) matches no OpenAI relay mode, which is why the URL a converted
// Claude request resolves to cannot be derived from info.RelayMode.
func claudeRelayInfo(channelType int, model string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatClaude,
		RequestURLPath:  "/v1/messages",
		OriginModelName: model,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			ChannelBaseUrl:    "https://upstream.example.com",
			UpstreamModelName: model,
			ApiVersion:        "account-1",
		},
	}
}

func claudeRequest(model string) *dto.ClaudeRequest {
	maxTokens := uint(64)
	return &dto.ClaudeRequest{
		Model:     model,
		MaxTokens: &maxTokens,
		System:    "you are brief",
		TopP:      common.GetPointer(1.0),
		Messages: []dto.ClaudeMessage{
			{Role: "user", Content: "weather?"},
			{Role: "assistant", Content: []dto.ClaudeMediaMessage{
				{Type: "tool_use", Id: "toolu_01AbCdEfGhIjKlMnOpQrStUv", Name: "get_weather", Input: map[string]any{"city": "Paris"}},
			}},
			{Role: "user", Content: []dto.ClaudeMediaMessage{
				{Type: "tool_result", ToolUseId: "toolu_01AbCdEfGhIjKlMnOpQrStUv", Content: "18C"},
			}},
		},
	}
}
