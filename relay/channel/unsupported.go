package channel

import (
	"fmt"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
)

// Unsupported is the single implementation of "this channel type cannot convert
// this request format". An adaptor embeds it to inherit every conversion its
// upstream protocol does not serve, instead of writing a stub method of its own.
//
// The contract is deliberately not "return some error":
//   - the answer is a client error (400), never a 5xx: reaching this method means
//     the request format and the selected channel type disagree, and a 5xx would
//     invite client retries and count against channel health;
//   - it carries ErrorCodeChannelFormatUnsupported, so the condition is
//     greppable in production logs;
//   - it skips channel retries: every channel of this type refuses the same
//     format, so a retry only hides the cause and burns other channels;
//   - it names the requested format and the channel type, so the caller can fix
//     the request instead of guessing what went wrong.
//
// A channel that gains real support defines the method itself; an explicit
// method always wins over the embedded one.
type Unsupported struct{}

func (Unsupported) ConvertClaudeRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ *dto.ClaudeRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "Claude Messages (/v1/messages)")
}

func (Unsupported) ConvertGeminiRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ *dto.GeminiChatRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "Gemini generateContent (/v1beta/models/...)")
}

func (Unsupported) ConvertOpenAIResponsesRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ dto.OpenAIResponsesRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "OpenAI Responses (/v1/responses)")
}

func (Unsupported) ConvertAudioRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ dto.AudioRequest) (io.Reader, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "audio (/v1/audio/...)")
}

func (Unsupported) ConvertImageRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ dto.ImageRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "image (/v1/images/...)")
}

func (Unsupported) ConvertEmbeddingRequest(_ *gin.Context, info *relaycommon.RelayInfo, _ dto.EmbeddingRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeOf(info), "embeddings (/v1/embeddings)")
}

// ConvertRerankRequest has no RelayInfo parameter, so the channel type comes
// from the request context that SetupContextForSelectedChannel filled in.
func (Unsupported) ConvertRerankRequest(c *gin.Context, _ int, _ dto.RerankRequest) (any, error) {
	return nil, unsupportedFormatError(channelTypeFromContext(c), "rerank (/v1/rerank)")
}

func unsupportedFormatError(channelType int, format string) *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		fmt.Errorf("channel type %d (%s) does not serve %s requests; send a format this channel serves, or declare the route on an advanced custom channel", channelType, constant.GetChannelTypeName(channelType), format),
		types.ErrorCodeChannelFormatUnsupported,
		http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(),
	)
}

func channelTypeOf(info *relaycommon.RelayInfo) int {
	if info == nil || info.ChannelMeta == nil {
		return 0
	}
	return info.ChannelMeta.ChannelType
}

func channelTypeFromContext(c *gin.Context) int {
	if c == nil {
		return 0
	}
	return common.GetContextKeyInt(c, constant.ContextKeyChannelType)
}
