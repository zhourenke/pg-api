package submodel

import (
	"errors"
	"io"
	"net/http"

	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	channel.Unsupported
}

// ConvertClaudeRequest serves Anthropic Messages through the OpenAI-compatible
// chat endpoint: Submodel offers no Anthropic dialect, so the request is
// converted to the chat shape and then shaped by this channel's own OpenAI rules.
func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, req, a.ConvertOpenAIRequest)
}

// ConvertGeminiRequest serves generateContent through the same endpoint:
// Submodel offers no Gemini dialect either.
func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	// The client's own path is forwarded as-is, and for a request that already
	// speaks OpenAI that path is the chat endpoint. The other two formats name
	// their own protocols instead (/v1/messages, /v1beta/models/...), so they have
	// to be mapped to the endpoint the conversion produces a body for.
	if info.RelayFormat == types.RelayFormatClaude || info.RelayFormat == types.RelayFormatGemini {
		return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, "/v1/chat/completions", info.ChannelType), nil
	}
	return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", "Bearer "+info.ApiKey)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if info.IsStream {
		usage, err = openai.OaiStreamHandler(c, info, resp)
	} else {
		usage, err = openai.OpenaiHandler(c, info, resp)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
