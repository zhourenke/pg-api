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
		{"minimax", constant.APITypeMiniMax, constant.ChannelTypeMiniMax, "https://upstream.example.com/v1/text/chatcompletion_v2", false},
		{"moonshot", constant.APITypeMoonshot, constant.ChannelTypeMoonshot, "https://upstream.example.com/v1/chat/completions", false},
		{"perplexity", constant.APITypePerplexity, constant.ChannelTypePerplexity, "https://upstream.example.com/chat/completions", true},
		{"siliconflow", constant.APITypeSiliconFlow, constant.ChannelTypeSiliconFlow, "https://upstream.example.com/v1/chat/completions", false},
		{"submodel", constant.APITypeSubmodel, constant.ChannelTypeSubmodel, "https://upstream.example.com/v1/chat/completions", false},
		{"volcengine", constant.APITypeVolcEngine, constant.ChannelTypeVolcEngine, "https://upstream.example.com/api/v3/chat/completions", false},
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
		{"minimax", constant.APITypeMiniMax, constant.ChannelTypeMiniMax},
		{"moonshot", constant.APITypeMoonshot, constant.ChannelTypeMoonshot},
		{"perplexity", constant.APITypePerplexity, constant.ChannelTypePerplexity},
		{"submodel", constant.APITypeSubmodel, constant.ChannelTypeSubmodel},
		{"volcengine", constant.APITypeVolcEngine, constant.ChannelTypeVolcEngine},
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

// The generic table above drives one base URL per channel, which cannot express a
// channel that picks its endpoint from the base URL as well as from the relay mode.
// Volcengine is one: its coding plans replace the host of the chat path, a bot
// model has a path of its own on the default host, and the Claude format keeps an
// Anthropic-compatible endpoint the Gemini format has no reason to use.
func TestVolcengineServesGeminiFromTheEndpointItsBaseUrlNames(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypeVolcEngine)
	require.NotNil(t, adaptor)

	tests := []struct {
		name    string
		baseURL string
		model   string
		wantURL string
	}{
		{
			name: "default base url", baseURL: "https://upstream.example.com", model: "doubao-seed-1-6",
			wantURL: "https://upstream.example.com/api/v3/chat/completions",
		},
		{
			name: "bot model", baseURL: "https://upstream.example.com", model: "bot-20250101",
			wantURL: "https://upstream.example.com/api/v3/bots/chat/completions",
		},
		{
			name: "coding plan", baseURL: "doubao-coding-plan", model: "doubao-seed-1-6",
			wantURL: "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/x:generateContent", nil)
			info := geminiRelayInfo(constant.ChannelTypeVolcEngine)
			info.ChannelBaseUrl = tt.baseURL
			info.OriginModelName = tt.model
			info.UpstreamModelName = tt.model

			requestURL, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, requestURL)

			converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)
			assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Volcengine: %s", encoded)
		})
	}

	// The converted body goes through this channel's own OpenAI conversion rather
	// than through the OpenAI adaptor's, and the thinking-suffix rewrite that only
	// the former carries is what proves it.
	t.Run("the channel's own OpenAI shaping applies", func(t *testing.T) {
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/x:generateContent", nil)
		info := geminiRelayInfo(constant.ChannelTypeVolcEngine)
		info.OriginModelName = "deepseek-v3.1-thinking"
		info.UpstreamModelName = "deepseek-v3.1-thinking"

		converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)
		assert.Equal(t, "deepseek-v3.1", gjson.GetBytes(encoded, "model").String(), string(encoded))
		assert.Equal(t, "enabled", gjson.GetBytes(encoded, "thinking.type").String(), string(encoded))
		assert.Equal(t, "deepseek-v3.1", info.UpstreamModelName, string(encoded))
	})

	// The converted formats share the chat endpoint, so the one format that does
	// have an endpoint of its own must not lose it to the new branch.
	t.Run("claude keeps the coding plan's Anthropic endpoint", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeVolcEngine, "doubao-seed-1-6")
		info.ChannelBaseUrl = "doubao-coding-plan"

		requestURL, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, "https://ark.cn-beijing.volces.com/api/coding/v1/messages", requestURL)
	})
}

// AWS builds one body for every format: this channel's own ConvertOpenAIRequest
// turns the chat request into the Anthropic Messages body Bedrock's InvokeModel
// takes, and AKSK mode then stamps anthropic_version on it. Gemini therefore needs
// no new upstream shape and no new handler — the Claude handlers this channel
// already delegates to render the client's protocol — but the Nova branch of that
// builder is chat-only: it takes no streaming and answers in the OpenAI shape, so
// a Nova model stays refused instead of returning the wrong protocol with a 200.
func TestAwsServesGeminiThroughItsBedrockBody(t *testing.T) {
	const model = "claude-3-5-sonnet-20240620"
	const anthropicBody = `{"id":"msg_1","type":"message","role":"assistant","model":"claude-3-5-sonnet-20240620",` +
		`"content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn",` +
		`"usage":{"input_tokens":3,"output_tokens":1}}`

	adaptor := GetAdaptor(constant.APITypeAws)
	require.NotNil(t, adaptor)

	t.Run("the request becomes Bedrock's Anthropic body", func(t *testing.T) {
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/x:generateContent", nil)
		info := geminiRelayInfo(constant.ChannelTypeAws)
		info.UpstreamModelName = model

		converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)

		assert.Equal(t, model, gjson.GetBytes(encoded, "model").String(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
		assert.Contains(t, gjson.GetBytes(encoded, "messages.0.content").String(), "hello")
		assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Bedrock: %s", encoded)
		assert.False(t, gjson.GetBytes(encoded, "choices").Exists(), string(encoded))
	})

	// API-key mode posts the body in the request itself instead of driving the SDK,
	// which makes it the one mode this package can drive without an AWS client: it
	// stands in here for the response half, since the rendering it borrows from the
	// Claude channel is what renders a Gemini client's answer. GetRequestURL is
	// called only because it selects the client mode DoResponse dispatches on; the
	// URL it returns is not asserted, because that mode assembles the host from the
	// two key halves in the other order (reported to the owner) and the AKSK mode
	// every other assertion here exercises does not use this URL at all.
	t.Run("the response keeps the Gemini shape", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c := gin.CreateTestContextOnly(recorder, gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/x:generateContent", nil)
		info := geminiRelayInfo(constant.ChannelTypeAws)
		info.UpstreamModelName = model
		info.ChannelOtherSettings.AwsKeyType = dto.AwsKeyTypeApiKey
		info.ApiKey = "bedrock-api-key|us-east-1"

		_, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)

		resp := &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(anthropicBody)),
		}
		usage, apiErr := adaptor.DoResponse(c, resp, info)
		require.Nil(t, apiErr)
		require.NotNil(t, usage)

		body := recorder.Body.Bytes()
		assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
		assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
		assert.False(t, gjson.GetBytes(body, "choices").Exists(), "a Gemini client must not receive the chat shape: %s", body)
	})

	// The control for the refusal below: Nova keeps its own conversion on the chat
	// format, so what is refused is that branch reaching a Gemini client.
	t.Run("nova keeps the chat format", func(t *testing.T) {
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		info := openaiRelayInfo(constant.ChannelTypeAws, "nova-lite-v1:0")

		converted, err := adaptor.ConvertOpenAIRequest(c, info, &dto.GeneralOpenAIRequest{
			Model:    "nova-lite-v1:0",
			Messages: []dto.Message{{Role: "user", Content: "hello"}},
		})
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)
		assert.Equal(t, "messages-v1", gjson.GetBytes(encoded, "schemaVersion").String(), string(encoded))
	})

	t.Run("a Nova model stays refused", func(t *testing.T) {
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		info := geminiRelayInfo(constant.ChannelTypeAws)
		info.UpstreamModelName = "nova-lite-v1:0"

		_, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		var apiErr *types.NewAPIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, types.ErrorCodeChannelFormatUnsupported, apiErr.GetErrorCode())
	})
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

// An OpenAI-compatible upstream decides how many chunks its answer arrives in and
// whether it reports usage at all, and the client has to receive a complete stream
// in its own protocol either way: one opening, one closing, and the same answer text
// billed as the OpenAI format bills it. The shared OpenAI handler owns that for every
// compatible channel, and it renders the last chunk of a stream separately from the
// ones before it, which is where the opening used to be emitted twice or not at all.
func TestConvertedStreamsAreCompleteWhateverTheUpstreamChunkCount(t *testing.T) {
	const model = "grok-3"
	const content = `{"id":"chatcmpl-1","model":"grok-3","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"}}]}`
	const finish = `{"id":"chatcmpl-1","model":"grok-3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`
	const single = `{"id":"chatcmpl-1","model":"grok-3","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}`
	const terminalUsage = `{"id":"chatcmpl-1","model":"grok-3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`

	bodyOf := func(frames ...string) string {
		var b strings.Builder
		for _, frame := range frames {
			b.WriteString("data: " + frame + "\n\n")
		}
		return b.String() + "data: [DONE]\n\n"
	}

	// One RelayInfo per client protocol, each shaped the way production builds it:
	// the chat path has a relay mode, the Claude path has none (no OpenAI relay mode
	// matches /v1/messages) and the Gemini path has its own. All three name the same
	// model, because the fallback completion count is model-dependent.
	infos := map[string]func() *relaycommon.RelayInfo{
		"openai": func() *relaycommon.RelayInfo {
			info := openaiRelayInfo(constant.ChannelTypeOpenAI, model)
			info.RelayMode = relayconstant.RelayModeChatCompletions
			return info
		},
		"claude": func() *relaycommon.RelayInfo {
			return claudeRelayInfo(constant.ChannelTypeOpenAI, model)
		},
		"gemini": func() *relaycommon.RelayInfo {
			info := geminiRelayInfo(constant.ChannelTypeOpenAI)
			info.OriginModelName = model
			info.UpstreamModelName = model
			return info
		},
	}

	run := func(t *testing.T, client string, body string) (string, *dto.Usage) {
		t.Helper()
		previousTimeout := constant.StreamingTimeout
		constant.StreamingTimeout = 30
		t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

		recorder := newStreamRecorder()
		c := gin.CreateTestContextOnly(recorder, gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		info := infos[client]()
		info.IsStream = true
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
			Body:       io.NopCloser(strings.NewReader(body)),
		}

		usageAny, apiErr := GetAdaptor(constant.APITypeOpenAI).DoResponse(c, resp, info)
		require.Nil(t, apiErr)
		usage, ok := usageAny.(*dto.Usage)
		require.True(t, ok)
		return recorder.Body.String(), usage
	}

	_, chatUsage := run(t, "openai", bodyOf(content, finish))
	require.Positive(t, chatUsage.CompletionTokens, "the answer text has to be counted when the upstream reports no usage")

	tests := []struct {
		name string
		// The client protocol, and the upstream frames it receives.
		client string
		body   string
		want   []string
		// A Claude stream opens the message exactly once; the chat protocol has no
		// opening event to duplicate.
		openingFrames  int
		closesWithDone bool
		// The answer text arrived in the same chunks as the chat case and the
		// upstream reported no usage, so the fallback count has to match it.
		billedLikeChat bool
	}{
		{
			name: "openai, one content chunk and a terminal chunk", client: "openai", body: bodyOf(content, finish),
			want: []string{content, finish}, closesWithDone: true, billedLikeChat: true,
		},
		{
			name: "claude, one content chunk and a terminal chunk", client: "claude", body: bodyOf(content, finish),
			want: []string{"content_block_start", `"text":"hi"`, "message_stop"}, openingFrames: 1, billedLikeChat: true,
		},
		{
			name: "claude, one chunk holding the whole answer", client: "claude", body: bodyOf(single),
			want: []string{"message_start", `"text":"hi"`, "message_stop"}, openingFrames: 1, billedLikeChat: true,
		},
		{
			name: "claude, terminal chunk reporting the usage", client: "claude", body: bodyOf(content, terminalUsage),
			want: []string{`"output_tokens":1`, "message_stop"}, openingFrames: 1,
		},
		{
			name: "claude, no data frame at all", client: "claude", body: bodyOf(),
			want: []string{"message_start", "message_delta", "message_stop"}, openingFrames: 1,
		},
		{
			name: "gemini, one content chunk and a terminal chunk", client: "gemini", body: bodyOf(content, finish),
			want: []string{"candidates", `"text":"hi"`, `"finishReason":"STOP"`, "totalTokenCount"}, billedLikeChat: true,
		},
		{
			name: "gemini, no data frame at all", client: "gemini", body: bodyOf(),
			want: []string{"candidates", "totalTokenCount"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, usage := run(t, tt.client, tt.body)

			for _, want := range tt.want {
				assert.Contains(t, body, want, body)
			}
			assert.Equal(t, tt.openingFrames, strings.Count(body, `"type":"message_start"`), body)
			if tt.closesWithDone {
				assert.Contains(t, body, "data: [DONE]", body)
			} else {
				assert.NotContains(t, body, "[DONE]", body)
			}
			if tt.billedLikeChat {
				assert.Equal(t, chatUsage.CompletionTokens, usage.CompletionTokens, body)
			}
		})
	}
}

// A channel that speaks a protocol of its own serves the converted formats
// through that protocol: the request is converted to the chat shape and then
// turned into the vendor request the channel always sends, and the vendor
// response is rendered back into the protocol the client asked for. Cohere is
// such a channel — its request flattens the messages into chat_history plus
// message, so the converted request looks nothing like a chat request.
func TestCohereConvertsTheOtherFormatsIntoItsOwnRequest(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypeCohere)
	require.NotNil(t, adaptor)

	tests := []struct {
		name    string
		convert func(c *gin.Context, info *relaycommon.RelayInfo) (any, error)
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, encoded []byte)
	}{
		{
			name: "gemini",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			},
			info: geminiRelayInfo(constant.ChannelTypeCohere),
			asserts: func(t *testing.T, encoded []byte) {
				// The Gemini request carries one user turn and no system prompt, so
				// Cohere receives it as the single prompt with no history.
				assert.Equal(t, "gemini-2.5-flash", gjson.GetBytes(encoded, "model").String(), string(encoded))
				assert.Equal(t, "hello", gjson.GetBytes(encoded, "message").String(), string(encoded))
				assert.Empty(t, gjson.GetBytes(encoded, "chat_history").Array(), string(encoded))
			},
		},
		{
			name: "claude",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertClaudeRequest(c, info, claudeRequest("cohere-model"))
			},
			info: claudeRelayInfo(constant.ChannelTypeCohere, "cohere-model"),
			asserts: func(t *testing.T, encoded []byte) {
				// The Anthropic system prompt and the tool_result turn become
				// history entries; the tool_result keeps its text but loses the
				// pairing the Anthropic request declared, which is what this
				// channel's chat conversion does for the OpenAI format as well.
				assert.Equal(t, "cohere-model", gjson.GetBytes(encoded, "model").String(), string(encoded))
				assert.Equal(t, "weather?", gjson.GetBytes(encoded, "message").String(), string(encoded))
				assert.Equal(t, "SYSTEM", gjson.GetBytes(encoded, "chat_history.0.role").String(), string(encoded))
				assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "chat_history.0.message").String(), string(encoded))
				assert.Equal(t, "USER", gjson.GetBytes(encoded, "chat_history.2.role").String(), string(encoded))
				assert.Equal(t, "18C", gjson.GetBytes(encoded, "chat_history.2.message").String(), string(encoded))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			requestURL, err := adaptor.GetRequestURL(tt.info)
			require.NoError(t, err)
			assert.Equal(t, "https://upstream.example.com/v1/chat", requestURL)

			converted, err := tt.convert(c, tt.info)
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)

			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Cohere: %s", encoded)
			assert.False(t, gjson.GetBytes(encoded, "system").Exists(), "the Anthropic shape must not reach Cohere: %s", encoded)
			tt.asserts(t, encoded)
		})
	}
}

func TestCohereRendersTheOtherFormatsFromItsOwnResponse(t *testing.T) {
	const upstreamBody = `{"response_id":"cohere-1","text":"hi","finish_reason":"COMPLETE",` +
		`"meta":{"billed_units":{"input_tokens":3,"output_tokens":1}}}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypeCohere),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
				assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypeCohere, "cohere-model"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
				assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeCohere).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			tt.asserts(t, body)
		})
	}
}

// A streaming converted request ends in the closing event of the client's own
// protocol rather than a chat [DONE], so the vendor stream has to run through the
// same chat-to-format rendering the OpenAI stream uses.
func TestCohereStreamsTheConvertedFormats(t *testing.T) {
	const upstreamStream = `{"is_finished":false,"text":"hi","event_type":"text-generation"}` + "\n" +
		`{"is_finished":true,"finish_reason":"COMPLETE","response":{"response_id":"cohere-1","text":"",` +
		`"meta":{"billed_units":{"input_tokens":3,"output_tokens":1}}}}` + "\n"

	tests := []struct {
		name        string
		info        *relaycommon.RelayInfo
		wantContain []string
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypeCohere),
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypeCohere, "cohere-model"),
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := newStreamRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			tt.info.IsStream = true
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(upstreamStream)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeCohere).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			assert.NotContains(t, body, "[DONE]", body)
		})
	}
}

// gin's Context.Stream refuses a writer that is not an http.CloseNotifier, which
// httptest.ResponseRecorder is not.
type streamRecorder struct {
	*httptest.ResponseRecorder
	closed chan bool
}

func newStreamRecorder() *streamRecorder {
	return &streamRecorder{ResponseRecorder: httptest.NewRecorder(), closed: make(chan bool)}
}

func (r *streamRecorder) CloseNotify() <-chan bool {
	return r.closed
}

// Ollama has two chat protocols behind one channel type: its own /api/chat and,
// when OllamaOpenAIChat is on, the OpenAI-compatible /v1/chat/completions. A
// Gemini client is served through whichever protocol the channel is configured
// for, so the endpoint, the request body and the response rendering all follow
// that choice.
func TestOllamaServesGeminiThroughBothChatProtocols(t *testing.T) {
	tests := []struct {
		name         string
		openAIChat   bool
		wantURL      string
		assertTarget func(t *testing.T, encoded []byte)
	}{
		{
			name:       "native ollama chat",
			openAIChat: false,
			wantURL:    "https://upstream.example.com/api/chat",
			assertTarget: func(t *testing.T, encoded []byte) {
				// Ollama's own chat request carries the sampling parameters in
				// options, not at the top level.
				assert.Equal(t, 1.5, gjson.GetBytes(encoded, "options.top_p").Float(), string(encoded))
				assert.False(t, gjson.GetBytes(encoded, "top_p").Exists(), string(encoded))
			},
		},
		{
			name:       "openai compatible chat",
			openAIChat: true,
			wantURL:    "https://upstream.example.com/v1/chat/completions",
			assertTarget: func(t *testing.T, encoded []byte) {
				assert.Equal(t, 1.5, gjson.GetBytes(encoded, "top_p").Float(), string(encoded))
				assert.False(t, gjson.GetBytes(encoded, "options").Exists(), string(encoded))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adaptor := GetAdaptor(constant.APITypeOllama)
			require.NotNil(t, adaptor)

			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			info := geminiRelayInfo(constant.ChannelTypeOllama)
			info.ChannelOtherSettings.OllamaOpenAIChat = tt.openAIChat

			requestURL, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.wantURL, requestURL)

			converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)

			assert.Equal(t, "gemini-2.5-flash", gjson.GetBytes(encoded, "model").String(), string(encoded))
			assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
			assert.Contains(t, gjson.GetBytes(encoded, "messages.0.content").String(), "hello")
			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Ollama: %s", encoded)
			tt.assertTarget(t, encoded)
		})
	}
}

// The native chat response is Ollama's own shape (a single object or NDJSON
// lines); the Gemini client is answered from the chat body the handler already
// builds, and the OpenAI-compatible half is rendered by the OpenAI adaptor.
func TestOllamaRendersGeminiFromBothChatProtocols(t *testing.T) {
	const nativeBody = `{"model":"llama3.1","created_at":"2026-10-11T00:00:00Z",` +
		`"message":{"role":"assistant","content":"hi"},"done":true,"done_reason":"stop",` +
		`"prompt_eval_count":3,"eval_count":2}`
	const chatBody = `{"id":"chatcmpl-1","object":"chat.completion","model":"llama3.1",` +
		`"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],` +
		`"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`

	tests := []struct {
		name       string
		openAIChat bool
		body       string
	}{
		{"native ollama chat", false, nativeBody},
		{"openai compatible chat", true, chatBody},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			info := geminiRelayInfo(constant.ChannelTypeOllama)
			info.ChannelOtherSettings.OllamaOpenAIChat = tt.openAIChat
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(tt.body)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeOllama).DoResponse(c, resp, info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
			assert.Equal(t, int64(5), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "a Gemini client must not receive the chat shape: %s", body)
		})
	}
}

// A native Ollama stream is NDJSON, and the Gemini client still receives Gemini
// chunks and none of the chat stream's closing frames.
func TestOllamaStreamsGeminiFromItsNativeProtocol(t *testing.T) {
	const nativeStream = `{"model":"llama3.1","created_at":"2026-10-11T00:00:00Z",` +
		`"message":{"role":"assistant","content":"hi"},"done":false}` + "\n" +
		`{"model":"llama3.1","created_at":"2026-10-11T00:00:01Z","message":{"role":"assistant","content":""},` +
		`"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":2}` + "\n"

	recorder := httptest.NewRecorder()
	c := gin.CreateTestContextOnly(recorder, gin.New())
	info := geminiRelayInfo(constant.ChannelTypeOllama)
	info.IsStream = true
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/x-ndjson"}},
		Body:       io.NopCloser(strings.NewReader(nativeStream)),
	}

	usage, apiErr := GetAdaptor(constant.APITypeOllama).DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)

	body := recorder.Body.String()
	assert.Contains(t, body, "candidates", body)
	assert.Contains(t, body, "hi", body)
	assert.Contains(t, body, "totalTokenCount", body)
	assert.NotContains(t, body, "[DONE]", body)
}

// A Dify app takes one flattened prompt instead of a message list, so the
// converted formats are turned into a chat request and then flattened by the
// channel's own conversion, exactly like the OpenAI format.
func TestDifyConvertsTheOtherFormatsIntoItsOwnRequest(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypeDify)
	require.NotNil(t, adaptor)

	tests := []struct {
		name    string
		convert func(c *gin.Context, info *relaycommon.RelayInfo) (any, error)
		info    *relaycommon.RelayInfo
		query   string
	}{
		{
			name: "gemini",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			},
			info:  geminiRelayInfo(constant.ChannelTypeDify),
			query: "USER: \nhello\n",
		},
		{
			name: "claude",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertClaudeRequest(c, info, claudeRequest("dify-model"))
			},
			info: claudeRelayInfo(constant.ChannelTypeDify, "dify-model"),
			// The Anthropic system prompt and the tool_result turn keep their text
			// but lose the roles Dify has no notion of, which is what this channel
			// already does with the OpenAI format.
			query: "SYSTEM: \nyou are brief\nUSER: \nweather?\nASSISTANT: \n\nUSER: \n18C\n",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			requestURL, err := adaptor.GetRequestURL(tt.info)
			require.NoError(t, err)
			assert.Equal(t, "https://upstream.example.com/v1/chat-messages", requestURL)

			converted, err := tt.convert(c, tt.info)
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)

			assert.Equal(t, tt.query, gjson.GetBytes(encoded, "query").String(), string(encoded))
			assert.Equal(t, "blocking", gjson.GetBytes(encoded, "response_mode").String(), string(encoded))
			assert.NotEmpty(t, gjson.GetBytes(encoded, "user").String(), string(encoded))
			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Dify: %s", encoded)
			assert.False(t, gjson.GetBytes(encoded, "system").Exists(), "the Anthropic shape must not reach Dify: %s", encoded)
		})
	}
}

func TestDifyRendersTheOtherFormatsFromItsOwnResponse(t *testing.T) {
	const upstreamBody = `{"conversation_id":"dify-1","answer":"hi","created_at":1,` +
		`"metadata":{"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypeDify),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
				assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypeDify, "dify-model"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
				assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeDify).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			tt.asserts(t, body)
		})
	}
}

// A Dify stream carries answer chunks and one message_end with the usage; the
// converted formats are rendered from those chunks and close with their own
// event instead of a chat [DONE], including when the run answers with nothing.
func TestDifyStreamsTheConvertedFormats(t *testing.T) {
	const upstreamStream = `data: {"event":"message","conversation_id":"dify-1","answer":"hi"}` + "\n\n" +
		`data: {"event":"message_end","conversation_id":"dify-1","metadata":{"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}}` + "\n\n"
	const emptyStream = `data: {"event":"message_end","conversation_id":"dify-1","metadata":{"usage":{"prompt_tokens":3,"completion_tokens":0,"total_tokens":3}}}` + "\n\n"

	tests := []struct {
		name        string
		info        *relaycommon.RelayInfo
		upstream    string
		wantContain []string
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypeDify),
			upstream:    upstreamStream,
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypeDify, "dify-model"),
			upstream:    upstreamStream,
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop"},
		},
		{
			// A run without an answer sends no message event at all, and the
			// Claude client still has to receive a complete, closed stream.
			name:        "claude without an answer",
			info:        claudeRelayInfo(constant.ChannelTypeDify, "dify-model"),
			upstream:    emptyStream,
			wantContain: []string{"message_start", "message_delta", "message_stop"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The shared Dify scanner derives its idle timeout from this setting.
			previousTimeout := constant.StreamingTimeout
			constant.StreamingTimeout = 30
			t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

			recorder := newStreamRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.info.IsStream = true
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(tt.upstream)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeDify).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			assert.NotContains(t, body, "[DONE]", body)
		})
	}
}

// PaLM takes prompt.messages with an author per turn, so the converted formats
// are turned into a chat request and then reshaped by the channel's own
// conversion, exactly like the OpenAI format (which this channel used to forward
// as an unconverted chat body).
func TestPaLMConvertsTheOtherFormatsIntoItsOwnRequest(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypePaLM)
	require.NotNil(t, adaptor)

	tests := []struct {
		name    string
		convert func(c *gin.Context, info *relaycommon.RelayInfo) (any, error)
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, encoded []byte)
	}{
		{
			name: "gemini",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertGeminiRequest(c, info, geminiRequest())
			},
			info: geminiRelayInfo(constant.ChannelTypePaLM),
			asserts: func(t *testing.T, encoded []byte) {
				assert.Equal(t, "0", gjson.GetBytes(encoded, "prompt.messages.0.author").String(), string(encoded))
				assert.Equal(t, "hello", gjson.GetBytes(encoded, "prompt.messages.0.content").String(), string(encoded))
				assert.Equal(t, 1.5, gjson.GetBytes(encoded, "topP").Float(), string(encoded))
			},
		},
		{
			name: "claude",
			convert: func(c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
				return adaptor.ConvertClaudeRequest(c, info, claudeRequest("palm-model"))
			},
			info: claudeRelayInfo(constant.ChannelTypePaLM, "palm-model"),
			asserts: func(t *testing.T, encoded []byte) {
				// PaLM keeps the system prompt in its own field instead of the turn
				// list, and names the model's turns "1".
				assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "prompt.context").String(), string(encoded))
				assert.Equal(t, "0", gjson.GetBytes(encoded, "prompt.messages.0.author").String(), string(encoded))
				assert.Equal(t, "weather?", gjson.GetBytes(encoded, "prompt.messages.0.content").String(), string(encoded))
				assert.Equal(t, "1", gjson.GetBytes(encoded, "prompt.messages.1.author").String(), string(encoded))
				assert.Equal(t, "0", gjson.GetBytes(encoded, "prompt.messages.2.author").String(), string(encoded))
				assert.Equal(t, "18C", gjson.GetBytes(encoded, "prompt.messages.2.content").String(), string(encoded))
				// generateMessage has no max output tokens field to forward it to.
				assert.False(t, gjson.GetBytes(encoded, "max_tokens").Exists(), string(encoded))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
			requestURL, err := adaptor.GetRequestURL(tt.info)
			require.NoError(t, err)
			assert.Equal(t, "https://upstream.example.com/v1beta2/models/chat-bison-001:generateMessage", requestURL)

			converted, err := tt.convert(c, tt.info)
			require.NoError(t, err)
			encoded, err := common.Marshal(converted)
			require.NoError(t, err)

			assert.False(t, gjson.GetBytes(encoded, "messages").Exists(), "the chat shape must not reach PaLM: %s", encoded)
			assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach PaLM: %s", encoded)
			assert.False(t, gjson.GetBytes(encoded, "system").Exists(), "the Anthropic shape must not reach PaLM: %s", encoded)
			tt.asserts(t, encoded)
		})
	}
}

func TestPaLMRendersTheOtherFormatsFromItsOwnResponse(t *testing.T) {
	const upstreamBody = `{"candidates":[{"author":"1","content":"hi"}]}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypePaLM),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypePaLM, "palm-model"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypePaLM).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			tt.asserts(t, body)
		})
	}
}

// generateMessage has no streaming form: the whole answer arrives as one object
// and is emitted as the single terminal chunk, so the converted formats get one
// chunk that already carries the finish reason and the estimated usage.
func TestPaLMStreamsTheConvertedFormats(t *testing.T) {
	const upstreamBody = `{"candidates":[{"author":"1","content":"hi"}]}`

	tests := []struct {
		name        string
		info        *relaycommon.RelayInfo
		wantContain []string
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypePaLM),
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypePaLM, "palm-model"),
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			tt.info.IsStream = true
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypePaLM).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			assert.NotContains(t, body, "[DONE]", body)
		})
	}
}

// Zhipu serves Claude on two endpoints: the coding-plan base URLs expose an
// Anthropic-compatible endpoint that takes the Anthropic body unchanged, and every
// other base URL speaks the legacy v3 model-api protocol, which takes Zhipu's own
// prompt shape instead. Gemini has no dialect of its own on either base URL, so it
// follows the OpenAI format through the v3 protocol and this channel's own shaping.
func TestZhipuConvertsClaudeAndGeminiIntoTheShapeItsEndpointTakes(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypeZhipu)
	require.NotNil(t, adaptor)

	t.Run("coding plan", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6")
		info.ChannelBaseUrl = "glm-coding-plan"
		info.ApiKey = "coding-plan-key"

		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
		requestURL, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, "https://open.bigmodel.cn/api/anthropic/v1/messages", requestURL)

		header := http.Header{}
		require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
		// The Anthropic-compatible endpoint takes the key itself, not the signed
		// token the v3 model-api endpoints require.
		assert.Equal(t, "Bearer coding-plan-key", header.Get("Authorization"))

		converted, err := adaptor.ConvertClaudeRequest(c, info, claudeRequest("glm-4.6"))
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)
		assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "system").String(), string(encoded))
		assert.Equal(t, "weather?", gjson.GetBytes(encoded, "messages.0.content").String(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "prompt").Exists(), "the v3 shape must not reach the Anthropic endpoint: %s", encoded)
	})

	t.Run("v3 base url", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6")
		info.ApiKey = "zhipu-id.zhipu-secret"
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)

		requestURL, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, "https://upstream.example.com/api/paas/v3/model-api/glm-4.6/invoke", requestURL)

		// The v3 endpoints take the signed token on every format, including this
		// one: only the Anthropic-compatible endpoint takes the key itself.
		header := http.Header{}
		require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
		authorization := header.Get("Authorization")
		assert.NotEqual(t, "Bearer "+info.ApiKey, authorization)
		assert.Len(t, strings.Split(authorization, "."), 3, authorization)

		converted, err := adaptor.ConvertClaudeRequest(c, info, claudeRequest("glm-4.6"))
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)
		// The Anthropic system prompt becomes a prompt turn the v3 protocol
		// requires an acknowledgement after.
		assert.Equal(t, "system", gjson.GetBytes(encoded, "prompt.0.role").String(), string(encoded))
		assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "prompt.0.content").String(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "prompt.1.role").String(), string(encoded))
		assert.Equal(t, "Okay", gjson.GetBytes(encoded, "prompt.1.content").String(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "messages").Exists(), "the Anthropic shape must not reach Zhipu: %s", encoded)
		assert.False(t, gjson.GetBytes(encoded, "system").Exists(), "the Anthropic shape must not reach Zhipu: %s", encoded)
	})

	t.Run("gemini", func(t *testing.T) {
		info := geminiRelayInfo(constant.ChannelTypeZhipu)
		info.IsStream = true
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-flash:streamGenerateContent", nil)

		// The v3 protocol has one streaming method for every format.
		requestURL, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, "https://upstream.example.com/api/paas/v3/model-api/gemini-2.5-flash/sse-invoke", requestURL)

		converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)
		assert.Equal(t, "user", gjson.GetBytes(encoded, "prompt.0.role").String(), string(encoded))
		assert.Equal(t, "hello", gjson.GetBytes(encoded, "prompt.0.content").String(), string(encoded))
		// The request went through this channel's own OpenAI shaping, which is
		// what keeps top_p at a value the provider accepts.
		assert.Equal(t, 0.99, gjson.GetBytes(encoded, "top_p").Float(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Zhipu: %s", encoded)
	})
}

func TestZhipuRendersTheOtherFormatsFromItsOwnResponse(t *testing.T) {
	const upstreamBody = `{"code":200,"msg":"","success":true,"data":{"task_id":"zhipu-task-1",` +
		`"request_id":"zhipu-req-1","task_status":"SUCCESS","choices":[{"role":"assistant","content":"hi"}],` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypeZhipu),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
				assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
				assert.Equal(t, "end_turn", gjson.GetBytes(body, "stop_reason").String(), string(body))
				assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
				assert.Equal(t, int64(1), gjson.GetBytes(body, "usage.output_tokens").Int(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeZhipu).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			tt.asserts(t, body)
		})
	}
}

// A v3 stream is a run of data frames holding answer text and a trailing meta
// frame holding the finish reason and the usage, and the converted formats have to
// close on that meta frame instead of on a chat [DONE].
func TestZhipuStreamsTheConvertedFormats(t *testing.T) {
	const upstreamStream = "data:hi\n" +
		`meta: {"request_id":"zhipu-req-1","task_id":"zhipu-task-1","task_status":"finish",` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}` + "\n"

	tests := []struct {
		name         string
		info         *relaycommon.RelayInfo
		wantContain  []string
		openingFrame int
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypeZhipu),
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6"),
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop"},
			// The meta frame carries both the finish reason and the usage, so the
			// stream is opened and closed by that one frame: a second opening would
			// mean the terminal frame was rendered twice.
			openingFrame: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := newStreamRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			tt.info.IsStream = true
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(upstreamStream)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeZhipu).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			assert.NotContains(t, body, "[DONE]", body)
			assert.Equal(t, tt.openingFrame, strings.Count(body, `"type":"message_start"`), body)
		})
	}
}

func TestZhipuRendersClaudeFromTheAnthropicEndpoint(t *testing.T) {
	const upstreamBody = `{"id":"msg_1","type":"message","role":"assistant",` +
		`"model":"glm-4.6","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn",` +
		`"usage":{"input_tokens":3,"output_tokens":1}}`

	recorder := httptest.NewRecorder()
	c := gin.CreateTestContextOnly(recorder, gin.New())
	info := claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6")
	info.ChannelBaseUrl = "glm-coding-plan"
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}

	usage, apiErr := GetAdaptor(constant.APITypeZhipu).DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)

	body := recorder.Body.Bytes()
	assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
	assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
	assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
	assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
}

// Baidu's own protocol has no Anthropic and no Gemini dialect, so both formats
// are converted into a chat request and then reshaped by the channel's own OpenAI
// conversion, exactly like the OpenAI format itself. The request URL is not
// asserted here: resolving it fetches a Baidu access token from the vendor's fixed
// token host, and the endpoint is shared by every format, so the converted
// formats do not change it.
func TestBaiduConvertsTheOtherFormatsIntoItsOwnRequest(t *testing.T) {
	adaptor := GetAdaptor(constant.APITypeBaidu)
	require.NotNil(t, adaptor)

	t.Run("claude", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeBaidu, "ERNIE-4.0-8K")
		info.IsStream = true
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)

		maxTokens := uint(64)
		converted, err := adaptor.ConvertClaudeRequest(c, info, &dto.ClaudeRequest{
			Model:     "ERNIE-4.0-8K",
			MaxTokens: &maxTokens,
			Stream:    common.GetPointer(true),
			System:    "you are brief",
			Messages:  []dto.ClaudeMessage{{Role: "user", Content: "weather?"}},
		})
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)

		// A streaming client reaches the same endpoint, and the vendor body is what
		// tells Baidu to answer with SSE frames.
		assert.True(t, gjson.GetBytes(encoded, "stream").Bool(), string(encoded))
		// Anthropic carries the system prompt as a top-level field while a chat
		// upstream carries it as a message; Baidu has a field of its own for it, so
		// the message list holds the conversation turns only.
		assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "system").String(), string(encoded))
		assert.Equal(t, int64(1), gjson.GetBytes(encoded, "messages.#").Int(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
		assert.Equal(t, "weather?", gjson.GetBytes(encoded, "messages.0.content").String(), string(encoded))
		assert.Equal(t, int64(64), gjson.GetBytes(encoded, "max_output_tokens").Int(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Baidu: %s", encoded)
	})

	t.Run("gemini", func(t *testing.T) {
		info := geminiRelayInfo(constant.ChannelTypeBaidu)
		info.IsStream = true
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-flash:streamGenerateContent", nil)

		converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)

		assert.True(t, gjson.GetBytes(encoded, "stream").Bool(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "messages.0.role").String(), string(encoded))
		assert.Equal(t, "hello", gjson.GetBytes(encoded, "messages.0.content").String(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Baidu: %s", encoded)
	})
}

func TestBaiduRendersEveryFormatFromItsOwnResponse(t *testing.T) {
	const upstreamBody = `{"id":"as-1","object":"chat.completion","created":1700000000,"result":"hi",` +
		`"is_truncated":false,"need_clear_history":false,` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypeBaidu),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
				assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypeBaidu, "ERNIE-4.0-8K"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
				assert.Equal(t, "end_turn", gjson.GetBytes(body, "stop_reason").String(), string(body))
				// The Anthropic message takes its model name from the chat body,
				// which used to carry an empty one.
				assert.Equal(t, "ERNIE-4.0-8K", gjson.GetBytes(body, "model").String(), string(body))
				assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
				assert.Equal(t, int64(1), gjson.GetBytes(body, "usage.output_tokens").Int(), string(body))
			},
		},
		{
			name: "openai",
			info: openaiRelayInfo(constant.ChannelTypeBaidu, "ERNIE-4.0-8K"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "as-1", gjson.GetBytes(body, "id").String(), string(body))
				assert.Equal(t, "ERNIE-4.0-8K", gjson.GetBytes(body, "model").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "choices.0.message.content").String(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeBaidu).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			if tt.info.RelayFormat != types.RelayFormatOpenAI {
				assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			}
			tt.asserts(t, body)
		})
	}
}

// The OpenAI format keeps the chat stream this channel always sent, now closed
// with the [DONE] marker every other channel sends, while the converted formats
// close on the frame that carries both the finish reason and the usage.
func TestBaiduStreamsTheConvertedFormats(t *testing.T) {
	const upstreamStream = `data: {"id":"as-1","object":"chat.completion","created":1700000000,` +
		`"sentence_id":0,"is_end":false,"result":"hi"}` + "\n" +
		`data: {"id":"as-1","object":"chat.completion","created":1700000000,` +
		`"sentence_id":1,"is_end":true,"result":"",` +
		`"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}` + "\n"

	tests := []struct {
		name        string
		info        *relaycommon.RelayInfo
		wantContain []string
		// The OpenAI format is the one that ends with a chat [DONE].
		closesWithDone bool
		openingFrame   int
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypeBaidu),
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypeBaidu, "ERNIE-4.0-8K"),
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop", `"output_tokens":1`},
			// The closing frame carries the finish reason and the usage, so the
			// stream is opened and closed by that one frame: a second opening would
			// mean the terminal frame was rendered twice.
			openingFrame: 1,
		},
		{
			name:           "openai",
			info:           openaiRelayInfo(constant.ChannelTypeBaidu, "ERNIE-4.0-8K"),
			wantContain:    []string{`"id":"as-1"`, `"model":"ERNIE-4.0-8K"`, `"finish_reason":"stop"`},
			closesWithDone: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The shared Baidu scanner derives its idle timeout from this setting.
			previousTimeout := constant.StreamingTimeout
			constant.StreamingTimeout = 30
			t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })

			recorder := newStreamRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.info.IsStream = true
			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(upstreamStream)),
			}

			usage, apiErr := GetAdaptor(constant.APITypeBaidu).DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			if tt.closesWithDone {
				assert.Contains(t, body, "data: [DONE]", body)
			} else {
				assert.NotContains(t, body, "[DONE]", body)
			}
			assert.Equal(t, tt.openingFrame, strings.Count(body, `"type":"message_start"`), body)
		})
	}
}

// Tencent serves two protocols behind one channel type: a three-segment ak/sk key
// goes to the native TC3 action API, a single TokenHub key to an OpenAI-compatible
// endpoint. The native protocol has no Anthropic and no Gemini dialect of its own,
// so both formats are converted into a chat request and then reshaped by that
// adaptor's own OpenAI conversion, exactly like the OpenAI format. The endpoint, the
// action header and the TC3 signature are shared by all three formats, so nothing
// per format is asserted about them here.
func TestTencentConvertsTheOtherFormatsIntoItsOwnRequest(t *testing.T) {
	const apiKey = "1300000000|AKIDxxxxxxxxxxxxxxxx|secretxxxxxxxxxxxxxxxx"

	t.Run("claude", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeTencent, "hunyuan-pro")
		info.ApiKey = apiKey
		info.IsStream = true
		adaptor := GetAdaptor(constant.APITypeTencent)
		require.NotNil(t, adaptor)
		adaptor.Init(info)

		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
		common.SetContextKey(c, constant.ContextKeyChannelKey, apiKey)

		maxTokens := uint(64)
		converted, err := adaptor.ConvertClaudeRequest(c, info, &dto.ClaudeRequest{
			Model:     "hunyuan-pro",
			MaxTokens: &maxTokens,
			Stream:    common.GetPointer(true),
			System:    "you are brief",
			Messages:  []dto.ClaudeMessage{{Role: "user", Content: "weather?"}},
		})
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)

		// The Anthropic system prompt arrives as a message of its own, which is
		// the only place this protocol takes it, and the fields keep the
		// capitalized names the API is described with.
		assert.Equal(t, "hunyuan-pro", gjson.GetBytes(encoded, "Model").String(), string(encoded))
		assert.True(t, gjson.GetBytes(encoded, "Stream").Bool(), string(encoded))
		assert.Equal(t, int64(2), gjson.GetBytes(encoded, "Messages.#").Int(), string(encoded))
		assert.Equal(t, "system", gjson.GetBytes(encoded, "Messages.0.Role").String(), string(encoded))
		assert.Equal(t, "you are brief", gjson.GetBytes(encoded, "Messages.0.Content").String(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "Messages.1.Role").String(), string(encoded))
		assert.Equal(t, "weather?", gjson.GetBytes(encoded, "Messages.1.Content").String(), string(encoded))
		// The native protocol has no output-length field, so max_tokens is
		// dropped here exactly as it already is on the OpenAI path.
		assert.False(t, gjson.GetBytes(encoded, "max_tokens").Exists(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "system").Exists(), string(encoded))
	})

	t.Run("gemini", func(t *testing.T) {
		info := geminiRelayInfo(constant.ChannelTypeTencent)
		info.ApiKey = apiKey
		info.IsStream = true
		adaptor := GetAdaptor(constant.APITypeTencent)
		require.NotNil(t, adaptor)
		adaptor.Init(info)

		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-2.5-flash:streamGenerateContent", nil)
		common.SetContextKey(c, constant.ContextKeyChannelKey, apiKey)

		converted, err := adaptor.ConvertGeminiRequest(c, info, geminiRequest())
		require.NoError(t, err)
		encoded, err := common.Marshal(converted)
		require.NoError(t, err)

		assert.True(t, gjson.GetBytes(encoded, "Stream").Bool(), string(encoded))
		assert.Equal(t, "user", gjson.GetBytes(encoded, "Messages.0.Role").String(), string(encoded))
		assert.Equal(t, "hello", gjson.GetBytes(encoded, "Messages.0.Content").String(), string(encoded))
		assert.False(t, gjson.GetBytes(encoded, "contents").Exists(), "the Gemini shape must not reach Tencent: %s", encoded)
	})
}

// The native protocol answers inside a "Response" envelope, and the chat body built
// from it is the intermediate the converted formats are rendered from.
func TestTencentRendersEveryFormatFromItsOwnResponse(t *testing.T) {
	const apiKey = "1300000000|AKIDxxxxxxxxxxxxxxxx|secretxxxxxxxxxxxxxxxx"
	const upstreamBody = `{"Response":{"Id":"tencent-1","Created":1700000000,` +
		`"Choices":[{"FinishReason":"stop","Message":{"Role":"assistant","Content":"hi"}}],` +
		`"Usage":{"PromptTokens":3,"CompletionTokens":1,"TotalTokens":4},` +
		`"Error":{"Code":0,"Message":""}}}`

	tests := []struct {
		name    string
		info    *relaycommon.RelayInfo
		asserts func(t *testing.T, body []byte)
	}{
		{
			name: "gemini",
			info: geminiRelayInfo(constant.ChannelTypeTencent),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "hi", gjson.GetBytes(body, "candidates.0.content.parts.0.text").String(), string(body))
				assert.Equal(t, "STOP", gjson.GetBytes(body, "candidates.0.finishReason").String(), string(body))
				assert.Equal(t, int64(4), gjson.GetBytes(body, "usageMetadata.totalTokenCount").Int(), string(body))
			},
		},
		{
			name: "claude",
			info: claudeRelayInfo(constant.ChannelTypeTencent, "hunyuan-pro"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "message", gjson.GetBytes(body, "type").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "content.0.text").String(), string(body))
				assert.Equal(t, "end_turn", gjson.GetBytes(body, "stop_reason").String(), string(body))
				// The Anthropic message takes its model name from the chat body,
				// which used to carry an empty one.
				assert.Equal(t, "hunyuan-pro", gjson.GetBytes(body, "model").String(), string(body))
				assert.Equal(t, int64(3), gjson.GetBytes(body, "usage.input_tokens").Int(), string(body))
				assert.Equal(t, int64(1), gjson.GetBytes(body, "usage.output_tokens").Int(), string(body))
			},
		},
		{
			name: "openai",
			info: openaiRelayInfo(constant.ChannelTypeTencent, "hunyuan-pro"),
			asserts: func(t *testing.T, body []byte) {
				assert.Equal(t, "tencent-1", gjson.GetBytes(body, "id").String(), string(body))
				assert.Equal(t, "hunyuan-pro", gjson.GetBytes(body, "model").String(), string(body))
				assert.Equal(t, "hi", gjson.GetBytes(body, "choices.0.message.content").String(), string(body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.info.ApiKey = apiKey
			adaptor := GetAdaptor(constant.APITypeTencent)
			require.NotNil(t, adaptor)
			adaptor.Init(tt.info)

			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(upstreamBody)),
			}

			usage, apiErr := adaptor.DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.Bytes()
			if tt.info.RelayFormat != types.RelayFormatOpenAI {
				assert.False(t, gjson.GetBytes(body, "choices").Exists(), "the chat shape must not reach the client: %s", body)
			}
			tt.asserts(t, body)
		})
	}
}

// A native Tencent stream is a run of frames holding answer text plus one frame
// carrying the finish reason and no usage. The OpenAI format keeps the chat stream
// this channel always sent, now with the upstream id and the real model name on
// every frame and closed with [DONE]; the converted formats close on that terminal
// frame, whose closing event is emitted by the shared final-response helper from the
// usage this request is billed with.
func TestTencentStreamsTheConvertedFormats(t *testing.T) {
	const apiKey = "1300000000|AKIDxxxxxxxxxxxxxxxx|secretxxxxxxxxxxxxxxxx"
	const upstreamStream = `data: {"Id":"tencent-1","Created":1700000000,` +
		`"Choices":[{"Delta":{"Role":"assistant","Content":"hi"}}]}` + "\n" +
		`data: {"Id":"tencent-1","Created":1700000000,` +
		`"Choices":[{"FinishReason":"stop"}],` +
		`"Usage":{"PromptTokens":3,"CompletionTokens":1,"TotalTokens":4}}` + "\n"

	tests := []struct {
		name        string
		info        *relaycommon.RelayInfo
		wantContain []string
		// The OpenAI format is the one that ends with a chat [DONE].
		closesWithDone bool
		openingFrame   int
	}{
		{
			name:        "gemini",
			info:        geminiRelayInfo(constant.ChannelTypeTencent),
			wantContain: []string{"candidates", "hi", "totalTokenCount"},
		},
		{
			name:        "claude",
			info:        claudeRelayInfo(constant.ChannelTypeTencent, "hunyuan-pro"),
			wantContain: []string{"message_start", "content_block_delta", "hi", "message_stop", `"output_tokens"`},
			// The terminal frame is the only frame that closes the stream, so a
			// second opening would mean it was rendered twice.
			openingFrame: 1,
		},
		{
			name:           "openai",
			info:           openaiRelayInfo(constant.ChannelTypeTencent, "hunyuan-pro"),
			wantContain:    []string{`"id":"tencent-1"`, `"model":"hunyuan-pro"`, `"finish_reason":"stop"`},
			closesWithDone: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := newStreamRecorder()
			c := gin.CreateTestContextOnly(recorder, gin.New())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			tt.info.IsStream = true
			tt.info.ApiKey = apiKey
			adaptor := GetAdaptor(constant.APITypeTencent)
			require.NotNil(t, adaptor)
			adaptor.Init(tt.info)

			resp := &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"text/event-stream"}},
				Body:       io.NopCloser(strings.NewReader(upstreamStream)),
			}

			usage, apiErr := adaptor.DoResponse(c, resp, tt.info)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)

			body := recorder.Body.String()
			for _, want := range tt.wantContain {
				assert.Contains(t, body, want, body)
			}
			if tt.closesWithDone {
				assert.Contains(t, body, "data: [DONE]", body)
			} else {
				assert.NotContains(t, body, "[DONE]", body)
			}
			assert.Equal(t, tt.openingFrame, strings.Count(body, `"type":"message_start"`), body)
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

// An OpenAI-format request, which is the path that produces the chat body the
// converted formats are rendered from.
func openaiRelayInfo(channelType int, model string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatOpenAI,
		RequestURLPath:  "/v1/chat/completions",
		OriginModelName: model,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       channelType,
			ChannelBaseUrl:    "https://upstream.example.com",
			UpstreamModelName: model,
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
