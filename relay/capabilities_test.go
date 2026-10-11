package relay

import (
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
)

// constant.ChannelCapabilitiesByAPIType decides which channels the request-format
// preference in channel selection considers able to serve a format, so it has to
// track the adaptors exactly. This test derives the same matrix from the adaptors
// themselves and fails in both directions: a format declared as served but
// answered by channel.Unsupported (an adaptor lost a conversion), and a format
// declared as unserved but answered by something else (an adaptor gained one, or
// returned nil so the request would be forwarded instead of refused).
func TestChannelCapabilitiesMatchAdaptors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	probes := capabilityProbes()

	for apiType := 0; apiType < constant.APITypeDummy; apiType++ {
		adaptor := GetAdaptor(apiType)
		declared, hasDeclaration := constant.ChannelCapabilitiesByAPIType[apiType]

		if adaptor == nil {
			assert.Falsef(t, hasDeclaration, "api type %d has no adaptor but declares capabilities", apiType)
			continue
		}
		name := adaptor.GetChannelName()

		// These two cannot be described by the table: see its doc comment.
		if apiType == constant.APITypeAdvancedCustom || apiType == constant.APITypeTencent {
			assert.Falsef(t, hasDeclaration, "api type %d (%s) must stay out of the capability table", apiType, name)
			continue
		}
		require.Truef(t, hasDeclaration, "api type %d (%s) serves requests but declares no capabilities", apiType, name)

		c := gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New())
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
		derived := derivedCapabilities(adaptor, c, info, probes)

		assert.Equalf(t, capabilityReport(declared), capabilityReport(derived),
			"api type %d (%s): the table and the adaptor disagree, update constant.ChannelCapabilitiesByAPIType to %s",
			apiType, name, capabilityLiteral(derived))
	}
}

// Resolving through the api type keeps the declaration usable from channel
// selection, which holds a channel type, not an api type.
func TestChannelCapabilitiesForResolvesThroughTheAdaptorApiType(t *testing.T) {
	// Xunfei speaks a WebSocket protocol of its own and has no vendor dialect for
	// the other two formats: it converts them through the shared chat conversion,
	// so its row names exactly those and nothing else.
	caps, declared := common.ChannelCapabilitiesFor(constant.ChannelTypeXunfei)
	require.True(t, declared)
	assert.True(t, caps.Has(constant.CapabilityClaude))
	assert.True(t, caps.Has(constant.CapabilityGemini))
	assert.False(t, caps.Has(constant.CapabilityOpenAIResponses))

	caps, declared = common.ChannelCapabilitiesFor(constant.ChannelTypeOpenAI)
	require.True(t, declared)
	assert.True(t, caps.Has(constant.CapabilityClaude))
	assert.True(t, caps.Has(constant.CapabilityRerank))

	// Per-channel and per-key capabilities make no claim.
	for _, channelType := range []int{
		constant.ChannelTypeAdvancedCustom,
		constant.ChannelTypeVLLM,
		constant.ChannelTypeSGLang,
		constant.ChannelTypeTencent,
	} {
		_, declared = common.ChannelCapabilitiesFor(channelType)
		assert.Falsef(t, declared, "channel type %d must make no capability claim", channelType)
	}

	// A channel type with no api type of its own still relays through the OpenAI
	// adaptor, so it inherits that adaptor's capabilities instead of no claim.
	caps, declared = common.ChannelCapabilitiesFor(constant.ChannelTypeCustom)
	require.True(t, declared)
	assert.True(t, caps.Has(constant.CapabilityClaude))
}

type capabilityProbe struct {
	format constant.RelayFormatCapability
	call   func(channel.Adaptor, *gin.Context, *relaycommon.RelayInfo) (any, error)
}

func capabilityProbes() []capabilityProbe {
	return []capabilityProbe{
		{constant.CapabilityClaude, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertClaudeRequest(c, info, &dto.ClaudeRequest{})
		}},
		{constant.CapabilityGemini, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertGeminiRequest(c, info, &dto.GeminiChatRequest{})
		}},
		{constant.CapabilityOpenAIResponses, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertOpenAIResponsesRequest(c, info, dto.OpenAIResponsesRequest{})
		}},
		{constant.CapabilityAudio, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertAudioRequest(c, info, dto.AudioRequest{})
		}},
		{constant.CapabilityImage, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertImageRequest(c, info, dto.ImageRequest{})
		}},
		{constant.CapabilityEmbedding, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertEmbeddingRequest(c, info, dto.EmbeddingRequest{})
		}},
		{constant.CapabilityRerank, func(a channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo) (any, error) {
			return a.ConvertRerankRequest(c, info.RelayMode, dto.RerankRequest{})
		}},
	}
}

// derivedCapabilities reports which formats the adaptor answers with something
// other than the shared refusal. An empty request makes some real conversions
// panic, which counts as "answers", so the probe recovers.
func derivedCapabilities(adaptor channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo, probes []capabilityProbe) constant.Capabilities {
	var caps constant.Capabilities
	for _, probe := range probes {
		if !returnsUnsupportedFormat(adaptor, c, info, probe) {
			caps |= 1 << uint(probe.format)
		}
	}
	return caps
}

func returnsUnsupportedFormat(adaptor channel.Adaptor, c *gin.Context, info *relaycommon.RelayInfo, probe capabilityProbe) (unsupported bool) {
	defer func() {
		if recover() != nil {
			unsupported = false
		}
	}()
	_, err := probe.call(adaptor, c, info)
	var apiErr *types.NewAPIError
	return errors.As(err, &apiErr) && apiErr.GetErrorCode() == types.ErrorCodeChannelFormatUnsupported
}

func capabilityReport(caps constant.Capabilities) string {
	var served, refused []string
	for format := constant.CapabilityClaude; format <= constant.CapabilityRerank; format++ {
		if caps.Has(format) {
			served = append(served, format.String())
		} else {
			refused = append(refused, format.String())
		}
	}
	return fmt.Sprintf("serves [%s] refuses [%s]", strings.Join(served, " "), strings.Join(refused, " "))
}

func capabilityLiteral(caps constant.Capabilities) string {
	names := map[constant.RelayFormatCapability]string{
		constant.CapabilityClaude:          "CapabilityClaude",
		constant.CapabilityGemini:          "CapabilityGemini",
		constant.CapabilityOpenAIResponses: "CapabilityOpenAIResponses",
		constant.CapabilityAudio:           "CapabilityAudio",
		constant.CapabilityImage:           "CapabilityImage",
		constant.CapabilityEmbedding:       "CapabilityEmbedding",
		constant.CapabilityRerank:          "CapabilityRerank",
	}
	var parts []string
	for format := constant.CapabilityClaude; format <= constant.CapabilityRerank; format++ {
		if caps.Has(format) {
			parts = append(parts, "constant."+names[format])
		}
	}
	if len(parts) == 0 {
		return "0"
	}
	return "constant.CapabilitiesOf(" + strings.Join(parts, ", ") + ")"
}
