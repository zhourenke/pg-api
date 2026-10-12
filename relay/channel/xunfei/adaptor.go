package xunfei

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	channel.Unsupported
	request *dto.GeneralOpenAIRequest
	// 讯飞没有可以直接交给 http 客户端的请求：中转要拨的是一个 url 用渠道密钥签名、
	// 路径带请求所选版本号的 websocket。所以签名 url 与请求体需要的 domain 在准备响应时
	// 由被中转的请求解析一次，GetRequestURL 只把解析结果交给拨号。
	authUrl string
	domain  string
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if a.authUrl == "" {
		return "", errors.New("xunfei signs its websocket url while preparing the response")
	}
	return a.authUrl, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	a.request = request
	return request, nil
}

// ConvertClaudeRequest serves Anthropic Messages over the websocket protocol the
// channel speaks: xunfei has no Anthropic dialect, so the request becomes a chat
// request first and this channel's own shaping (one message list, system prompts
// folded into it) applies to it.
func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

// ConvertGeminiRequest serves generateContent the same way: the chat request is
// what requestOpenAI2Xunfei turns into the message list 讯飞 takes.
func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	// xunfei's request is not http request, so we don't need to do anything here
	dummyResp := &http.Response{}
	dummyResp.StatusCode = http.StatusOK
	return dummyResp, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	splits := strings.Split(info.ApiKey, "|")
	if len(splits) != 3 {
		return nil, types.NewError(errors.New("invalid auth"), types.ErrorCodeChannelInvalidKey)
	}
	if a.request == nil {
		return nil, types.NewError(errors.New("request is nil"), types.ErrorCodeInvalidRequest)
	}
	// The key parts are appId|apiSecret|apiKey, and the endpoint is signed with
	// the last two of them. Dialing through the shared helper is what gives the
	// channel the request context, its configured proxy and the status code of a
	// rejected handshake, none of which the dialer built here used to have.
	var apiVersion string
	a.domain, apiVersion, a.authUrl = getXunfeiAuthUrl(c, info, splits[2], splits[1], a.request.Model)
	// 文档给的分版本答案长度上限：请求超过它时夹到上限再发出去，而不是把整个请求拒掉
	// （`.agents/rules/billing.md` 要求适配器自己给这类乘数字段设界，clamp 是它认的做法
	// 之一）。夹的是交给 handler 的那一份拷贝：a.request 保持客户端原样，计费与日志读到
	// 的仍是客户端传的值。文档没给上限的版本（v2.1、kjwx 与不认识的版本）原样转发。
	request := *a.request
	if limit := xunfeiMaxOutputTokens(apiVersion); limit > 0 {
		// 与 dto.GeneralOpenAIRequest.GetMaxTokens 同一条优先级：max_completion_tokens 优先。
		if request.MaxCompletionTokens != nil && *request.MaxCompletionTokens > limit {
			request.MaxCompletionTokens = &limit
		} else if request.MaxTokens != nil && *request.MaxTokens > limit {
			request.MaxTokens = &limit
		}
	}
	conn, dialErr := channel.DoWssRequest(a, c, info, nil)
	if dialErr != nil {
		return nil, types.NewError(dialErr, types.ErrorCodeDoRequestFailed)
	}
	defer conn.Close()
	if info.IsStream {
		usage, err = xunfeiStreamHandler(c, info, conn, request, splits[0], a.domain)
	} else {
		usage, err = xunfeiHandler(c, info, conn, request, splits[0], a.domain)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
