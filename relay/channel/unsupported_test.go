package channel_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/ali"
	"github.com/zhourenke/pg-api/relay/channel/baidu_v2"
	"github.com/zhourenke/pg-api/relay/channel/codex"
	"github.com/zhourenke/pg-api/relay/channel/dify"
	"github.com/zhourenke/pg-api/relay/channel/ollama"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	"github.com/zhourenke/pg-api/relay/channel/replicate"
	"github.com/zhourenke/pg-api/relay/channel/volcengine"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
)

// A channel type that does not serve a request format must answer with one
// client error: 400 with a dedicated error code, no channel retry, and a
// message that names the requested format and the channel type. It must never
// panic (a panic aborts the request outside the normal error path) and never
// answer 5xx (that invites client retries and counts against channel health).
func assertUnsupportedFormat(t *testing.T, err error, channelTypeName string, format string) {
	t.Helper()
	var apiErr *types.NewAPIError
	require.ErrorAs(t, err, &apiErr)
	assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
	assert.Equal(t, types.ErrorCodeChannelFormatUnsupported, apiErr.GetErrorCode())
	assert.True(t, types.IsSkipRetryError(apiErr))
	assert.Contains(t, apiErr.Error(), channelTypeName)
	assert.Contains(t, apiErr.Error(), format)
}

func TestEmbeddedUnsupportedRefusesEveryFormatItDoesNotServe(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeDify}}
	context := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
	context.Set(string(constant.ContextKeyChannelType), constant.ChannelTypeDify)

	adaptor := &dify.Adaptor{}
	_, err := adaptor.ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{})
	assertUnsupportedFormat(t, err, "Dify", "OpenAI Responses")

	_, err = adaptor.ConvertAudioRequest(nil, info, dto.AudioRequest{})
	assertUnsupportedFormat(t, err, "Dify", "audio")

	_, err = adaptor.ConvertImageRequest(nil, info, dto.ImageRequest{})
	assertUnsupportedFormat(t, err, "Dify", "image")

	_, err = adaptor.ConvertEmbeddingRequest(nil, info, dto.EmbeddingRequest{})
	assertUnsupportedFormat(t, err, "Dify", "embeddings")

	// Rerank carries no RelayInfo, so the default reads the channel type from the
	// request context that channel selection filled in.
	_, err = adaptor.ConvertRerankRequest(context, 0, dto.RerankRequest{})
	assertUnsupportedFormat(t, err, "Dify", "rerank")
}

// A real conversion implemented by the adaptor always wins over the embedded
// default, so embedding it cannot hide existing support.
func TestExplicitConversionWinsOverEmbeddedUnsupported(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAli}}
	adaptor := &ali.Adaptor{}

	request := dto.EmbeddingRequest{Model: "text-embedding-v3"}
	converted, err := adaptor.ConvertEmbeddingRequest(nil, info, request)
	require.NoError(t, err)
	assert.Equal(t, request, converted)

	_, err = adaptor.ConvertAudioRequest(nil, info, dto.AudioRequest{})
	assertUnsupportedFormat(t, err, "Ali", "audio")
}

// Channels that expose only their own endpoints answer the universal OpenAI chat
// format with the same client error, instead of a bare error the request path
// would wrap as a 500. Unsupported has no method for that format, so the refusal
// comes from channel.UnsupportedFormat.
func TestUniversalChatFormatIsRefusedWithTheSharedClientError(t *testing.T) {
	tests := []struct {
		name        string
		adaptor     channel.Adaptor
		channelType int
	}{
		{"codex", &codex.Adaptor{}, constant.ChannelTypeCodex},
		{"replicate", &replicate.Adaptor{}, constant.ChannelTypeReplicate},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tt.channelType}}
			_, err := tt.adaptor.ConvertOpenAIRequest(nil, info, &dto.GeneralOpenAIRequest{Model: "some-model"})
			assertUnsupportedFormat(t, err, constant.GetChannelTypeName(tt.channelType), "OpenAI chat completions")
		})
	}
}

// The formats these channel types do not serve come from the embedded default:
// the explicit stubs they replaced answered 500 without the format and channel
// name, and the capability table counted them as served.
func TestChannelsWithoutTheFormatAnswerTheSharedClientError(t *testing.T) {
	tests := []struct {
		name          string
		channelType   int
		convert       func(info *relaycommon.RelayInfo) error
		wantFormatSub string
	}{
		{
			name: "codex gemini", channelType: constant.ChannelTypeCodex,
			convert: func(info *relaycommon.RelayInfo) error {
				_, err := (&codex.Adaptor{}).ConvertGeminiRequest(nil, info, &dto.GeminiChatRequest{})
				return err
			},
			wantFormatSub: "Gemini generateContent",
		},
		{
			name: "codex claude", channelType: constant.ChannelTypeCodex,
			convert: func(info *relaycommon.RelayInfo) error {
				_, err := (&codex.Adaptor{}).ConvertClaudeRequest(nil, info, &dto.ClaudeRequest{})
				return err
			},
			wantFormatSub: "Claude Messages",
		},
		{
			// Ollama serves the Gemini format through its own chat protocol, but
			// it has no image endpoint at all.
			name: "ollama image", channelType: constant.ChannelTypeOllama,
			convert: func(info *relaycommon.RelayInfo) error {
				_, err := (&ollama.Adaptor{}).ConvertImageRequest(nil, info, dto.ImageRequest{})
				return err
			},
			wantFormatSub: "image",
		},
		{
			name: "replicate claude", channelType: constant.ChannelTypeReplicate,
			convert: func(info *relaycommon.RelayInfo) error {
				_, err := (&replicate.Adaptor{}).ConvertClaudeRequest(nil, info, &dto.ClaudeRequest{})
				return err
			},
			wantFormatSub: "Claude Messages",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tt.channelType}}
			assertUnsupportedFormat(t, tt.convert(info), constant.GetChannelTypeName(tt.channelType), tt.wantFormatSub)
		})
	}
}

// Missing channel metadata must still produce the same client error instead of a
// nil dereference: the default implementation runs before any channel context is
// guaranteed to exist.
func TestEmbeddedUnsupportedToleratesMissingChannelMeta(t *testing.T) {
	_, err := channel.Unsupported{}.ConvertGeminiRequest(nil, nil, nil)
	assertUnsupportedFormat(t, err, "Unknown", "Gemini generateContent")

	_, err = channel.Unsupported{}.ConvertRerankRequest(nil, 0, dto.RerankRequest{})
	assertUnsupportedFormat(t, err, "Unknown", "rerank")
}

// Channels whose provider serves rerank from the body the client already sent
// keep their pass-through; the shared default must not turn them into a
// refusal. volcengine and baidu_v2 post to rerank endpoints of their own
// (/api/v3/rerank and /v2/rerank), but the fields they take are the ones
// dto.RerankRequest carries, so the body goes out verbatim.
func TestRerankPassThroughSurvivesTheSharedDefault(t *testing.T) {
	topN := 1
	request := dto.RerankRequest{
		Model:     "bge-reranker-v2-m3",
		Query:     "question",
		Documents: []any{"first", "second"},
		TopN:      &topN,
	}

	for _, tc := range []struct {
		name    string
		adaptor channel.Adaptor
	}{
		{"openai", &openai.Adaptor{}},
		{"volcengine", &volcengine.Adaptor{}},
		{"baidu_v2", &baidu_v2.Adaptor{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			converted, err := tc.adaptor.ConvertRerankRequest(nil, 0, request)
			require.NoError(t, err)
			assert.Equal(t, request, converted)
		})
	}
}
