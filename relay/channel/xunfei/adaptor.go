package xunfei

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/zhourenke/pg-api/relay/channel"
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
	a.domain, a.authUrl = getXunfeiAuthUrl(c, info, splits[2], splits[1], a.request.Model)
	conn, dialErr := channel.DoWssRequest(a, c, info, nil)
	if dialErr != nil {
		return nil, types.NewError(dialErr, types.ErrorCodeDoRequestFailed)
	}
	defer conn.Close()
	if info.IsStream {
		usage, err = xunfeiStreamHandler(c, conn, *a.request, splits[0], a.domain)
	} else {
		usage, err = xunfeiHandler(c, conn, *a.request, splits[0], a.domain)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
