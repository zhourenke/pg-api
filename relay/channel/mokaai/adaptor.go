package mokaai

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/zhourenke/pg-api/relay/channel"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/constant"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	channel.Unsupported
}

// ConvertEmbeddingRequest passes the OpenAI embedding request through: this
// channel serves the OpenAI embeddings shape as-is.
func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {

}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	// https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t
	suffix := "chat/"
	if strings.HasPrefix(info.UpstreamModelName, "m3e") {
		suffix = "embeddings"
	}
	fullRequestURL := fmt.Sprintf("%s/%s", info.ChannelBaseUrl, suffix)
	return fullRequestURL, nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", fmt.Sprintf("Bearer %s", info.ApiKey))
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	switch info.RelayMode {
	case constant.RelayModeEmbeddings:
		baiduEmbeddingRequest := embeddingRequestOpenAI2Moka(*request)
		return baiduEmbeddingRequest, nil
	default:
		// This channel serves the OpenAI embeddings shape only; its other endpoint
		// is the Moka console chat page, not a chat completions API.
		return nil, channel.UnsupportedFormat(info, "OpenAI chat completions (/v1/chat/completions)")
	}
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {

	switch info.RelayMode {
	case constant.RelayModeEmbeddings:
		return mokaEmbeddingHandler(c, info, resp)
	default:
		// err, usage = mokaHandler(c, resp)

	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
