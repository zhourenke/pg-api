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

// Zhipu's Anthropic-compatible endpoint exists only for the coding-plan base URLs,
// which are stored as the plan name in the channel's base URL field. Any other base
// URL speaks the legacy v3 model-api protocol, which takes neither an Anthropic
// body nor anything derived from one, so the shared refusal stays in place there and
// the capability cannot be declared per api type.
func TestZhipuServesClaudeOnCodingPlanBasesOnly(t *testing.T) {
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

	t.Run("legacy base url", func(t *testing.T) {
		info := claudeRelayInfo(constant.ChannelTypeZhipu, "glm-4.6")
		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())

		_, err := adaptor.ConvertClaudeRequest(c, info, claudeRequest("glm-4.6"))
		var apiErr *types.NewAPIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
		assert.Equal(t, types.ErrorCodeChannelFormatUnsupported, apiErr.GetErrorCode())

		// The v3 endpoint is still the one the OpenAI format uses.
		requestURL, err := adaptor.GetRequestURL(info)
		require.NoError(t, err)
		assert.Equal(t, "https://upstream.example.com/api/paas/v3/model-api/glm-4.6/invoke", requestURL)
	})
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
