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
	"github.com/zhourenke/pg-api/relay/channel/mistral"
	"github.com/zhourenke/pg-api/relay/channel/openai"
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
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeMistral}}
	context := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
	context.Set(string(constant.ContextKeyChannelType), constant.ChannelTypeMistral)

	adaptor := &mistral.Adaptor{}
	_, err := adaptor.ConvertClaudeRequest(nil, info, &dto.ClaudeRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "Claude Messages")

	_, err = adaptor.ConvertGeminiRequest(nil, info, &dto.GeminiChatRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "Gemini generateContent")

	_, err = adaptor.ConvertOpenAIResponsesRequest(nil, info, dto.OpenAIResponsesRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "OpenAI Responses")

	_, err = adaptor.ConvertAudioRequest(nil, info, dto.AudioRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "audio")

	_, err = adaptor.ConvertImageRequest(nil, info, dto.ImageRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "image")

	_, err = adaptor.ConvertEmbeddingRequest(nil, info, dto.EmbeddingRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "embeddings")

	// Rerank carries no RelayInfo, so the default reads the channel type from the
	// request context that channel selection filled in.
	_, err = adaptor.ConvertRerankRequest(context, 0, dto.RerankRequest{})
	assertUnsupportedFormat(t, err, "Mistral", "rerank")
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

	_, err = adaptor.ConvertGeminiRequest(nil, info, &dto.GeminiChatRequest{})
	assertUnsupportedFormat(t, err, "Ali", "Gemini generateContent")
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

// Channels that forward the incoming path to an OpenAI-compatible rerank
// endpoint keep their pass-through; the shared default must not turn them into
// a refusal.
func TestRerankPassThroughSurvivesTheSharedDefault(t *testing.T) {
	request := dto.RerankRequest{Model: "bge-reranker-v2-m3", Query: "question", Documents: []any{"doc"}}
	converted, err := (&openai.Adaptor{}).ConvertRerankRequest(nil, 0, request)
	require.NoError(t, err)
	assert.Equal(t, request, converted)
}
