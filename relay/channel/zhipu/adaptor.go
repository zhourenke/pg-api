package zhipu

import (
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/samber/lo"
	channelconstant "github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/claude"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	channel.Unsupported
}

// zhipuClaudeEndpoint reports the Anthropic-compatible endpoint this channel's
// base URL provides. Only the coding-plan base URLs have one: they are stored as
// the plan name in the channel's base URL field, and every other Zhipu base URL
// speaks the legacy v3 model-api protocol only.
func zhipuClaudeEndpoint(info *relaycommon.RelayInfo) (string, bool) {
	if info == nil || info.ChannelMeta == nil {
		return "", false
	}
	plan, ok := channelconstant.ChannelSpecialBases[info.ChannelBaseUrl]
	if !ok || plan.ClaudeBaseURL == "" {
		return "", false
	}
	return plan.ClaudeBaseURL, true
}

// ConvertClaudeRequest serves Anthropic Messages where the provider exposes an
// Anthropic-compatible endpoint, and answers the shared refusal everywhere else,
// because the legacy v3 model-api endpoints take neither an Anthropic body nor
// anything derived from one. The capability is therefore per channel, which is
// why APITypeZhipu claims no format in constant.ChannelCapabilitiesByAPIType.
func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if _, ok := zhipuClaudeEndpoint(info); !ok {
		return channel.Unsupported{}.ConvertClaudeRequest(c, info, request)
	}
	adaptor := claude.Adaptor{}
	return adaptor.ConvertClaudeRequest(c, info, request)
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if baseURL, ok := zhipuClaudeEndpoint(info); ok && info.RelayFormat == types.RelayFormatClaude {
		return fmt.Sprintf("%s/v1/messages", baseURL), nil
	}
	method := "invoke"
	if info.IsStream {
		method = "sse-invoke"
	}
	return fmt.Sprintf("%s/api/paas/v3/model-api/%s/%s", info.ChannelBaseUrl, info.UpstreamModelName, method), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	if info.RelayFormat == types.RelayFormatClaude {
		// The Anthropic-compatible endpoint takes the API key itself; the signed
		// token below belongs to the v3 model-api endpoints.
		req.Set("Authorization", "Bearer "+info.ApiKey)
		return nil
	}
	token := getZhipuToken(info.ApiKey)
	req.Set("Authorization", token)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	if lo.FromPtrOr(request.TopP, 0) >= 1 {
		request.TopP = lo.ToPtr(0.99)
	}
	return requestOpenAI2Zhipu(*request), nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if info.RelayFormat == types.RelayFormatClaude {
		adaptor := claude.Adaptor{}
		return adaptor.DoResponse(c, resp, info)
	}
	if info.IsStream {
		usage, err = zhipuStreamHandler(c, info, resp)
	} else {
		usage, err = zhipuHandler(c, info, resp)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
