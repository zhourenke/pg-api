package relay

import (
	"io"
	"net/http"
	"net/http/httptest"
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

// An OpenAI-compatible channel serves the Gemini format the same way it serves
// the OpenAI format: the request is converted to a chat request, the channel's
// own OpenAI shaping is applied to it, and it goes to the channel's chat
// endpoint. These channels have no Gemini-dialect upstream of their own, so the
// three pieces have to agree, and the capability table (checked by
// capabilities_test.go) only covers the first of them.
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

// The client asked for generateContent and gets generateContent back. A channel
// whose own response handler writes the OpenAI shape has to leave the Gemini
// format to the OpenAI adaptor, which is the only handler that renders a chat
// body in the client's protocol.
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
