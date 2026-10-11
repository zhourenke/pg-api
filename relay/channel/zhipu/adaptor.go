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
	"github.com/zhourenke/pg-api/relay/channel/openai"
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

// ConvertClaudeRequest serves Anthropic Messages on two paths: the coding-plan
// base URLs expose an Anthropic-compatible endpoint, so the request goes there
// unchanged, and every other base URL speaks the v3 model-api protocol, which
// takes a chat request shaped into its own prompt format instead.
func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	if _, ok := zhipuClaudeEndpoint(info); ok {
		adaptor := claude.Adaptor{}
		return adaptor.ConvertClaudeRequest(c, info, request)
	}
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

// ConvertGeminiRequest serves generateContent through the v3 model-api endpoint
// the OpenAI format uses: Zhipu offers no Gemini dialect on any base URL, not
// even the coding-plan ones, so the request is converted to the chat shape and
// then shaped by this channel's own OpenAI rules.
func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

// GetRequestURL sends the Claude format to the coding plan's Anthropic endpoint
// when the base URL names one, and every other request to the legacy v3
// model-api endpoint. A plan marker is an endpoint for the Claude format only:
// the other formats keep using the base URL the channel carries, which for a
// plan marker names no host, so a channel that serves them needs a real base URL
// (the V4 adaptor is the one that reaches a plan from every format).
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
	if _, ok := zhipuClaudeEndpoint(info); ok && info.RelayFormat == types.RelayFormatClaude {
		// The Anthropic-compatible endpoint takes the API key itself; the signed
		// token below belongs to the v3 model-api endpoints, which is where every
		// other request goes, including the Claude format on a non-plan base URL.
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
	// Only the coding-plan endpoint answers in the Anthropic dialect, and the
	// Claude adaptor is what renders that. Every other request is a v3 model-api
	// call, whose own response the handlers below render into the client's
	// protocol, including the Claude one.
	if info.RelayFormat == types.RelayFormatClaude {
		if _, ok := zhipuClaudeEndpoint(info); ok {
			adaptor := claude.Adaptor{}
			return adaptor.DoResponse(c, resp, info)
		}
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
