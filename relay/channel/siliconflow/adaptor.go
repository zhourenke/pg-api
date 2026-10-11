package siliconflow

import (
	"fmt"
	"io"
	"net/http"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/constant"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type Adaptor struct {
	channel.Unsupported
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, req *dto.ClaudeRequest) (any, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertClaudeRequest(c, info, req)
}

// ConvertGeminiRequest serves generateContent through the OpenAI-compatible chat
// endpoint: SiliconFlow offers no Gemini dialect, so the request is converted to
// the chat shape and then shaped by this channel's own OpenAI rules.
func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

func (a *Adaptor) ConvertAudioRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.AudioRequest) (io.Reader, error) {
	adaptor := openai.Adaptor{}
	return adaptor.ConvertAudioRequest(c, info, request)
}

func (a *Adaptor) ConvertImageRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	// 解析extra到SFImageRequest里，以填入SiliconFlow特殊字段。若失败重建一个空的。
	sfRequest := &SFImageRequest{}
	extra, err := common.Marshal(request.Extra)
	if err == nil {
		err = common.Unmarshal(extra, sfRequest)
		if err != nil {
			sfRequest = &SFImageRequest{}
		}
	}

	sfRequest.Model = request.Model
	sfRequest.Prompt = request.Prompt
	// 优先使用image_size/batch_size，否则使用OpenAI标准的size/n
	if sfRequest.ImageSize == "" {
		sfRequest.ImageSize = request.Size
	}
	if sfRequest.BatchSize == 0 {
		if request.N != nil {
			sfRequest.BatchSize = lo.FromPtr(request.N)
		}
	}

	return sfRequest, nil
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info.RelayMode == constant.RelayModeRerank {
		return fmt.Sprintf("%s/v1/rerank", info.ChannelBaseUrl), nil
	}
	// The client's path is forwarded as-is, and for a request that already speaks
	// OpenAI that path is the chat endpoint. A generateContent request names the
	// Gemini protocol instead, so it has to be mapped to the chat endpoint.
	if info.RelayFormat == types.RelayFormatGemini {
		return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, "/v1/chat/completions", info.ChannelType), nil
	}
	return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, info.RequestURLPath, info.ChannelType), nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	channel.SetupApiRequestHeader(info, c, req)
	req.Set("Authorization", fmt.Sprintf("Bearer %s", info.ApiKey))
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	// SiliconFlow requires messages array for FIM requests, even if client doesn't send it
	if (request.Prefix != nil || request.Suffix != nil) && len(request.Messages) == 0 {
		// Add an empty user message to satisfy SiliconFlow's requirement
		request.Messages = []dto.Message{
			{
				Role:    "user",
				Content: "",
			},
		}
	}
	return request, nil
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	adaptor := openai.Adaptor{}
	return adaptor.DoRequest(c, info, requestBody)
}

func (a *Adaptor) ConvertRerankRequest(c *gin.Context, relayMode int, request dto.RerankRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) ConvertEmbeddingRequest(c *gin.Context, info *relaycommon.RelayInfo, request dto.EmbeddingRequest) (any, error) {
	return request, nil
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	switch info.RelayMode {
	case constant.RelayModeRerank:
		usage, err = siliconflowRerankHandler(c, info, resp)
	default:
		adaptor := openai.Adaptor{}
		usage, err = adaptor.DoResponse(c, resp, info)
	}
	return
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
