package aws

import (
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/pkg/errors"
	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/claude"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	channel.Unsupported
	AwsClient *bedrockruntime.Client
	AwsReq    any
	IsNova    bool
}

func (a *Adaptor) ConvertClaudeRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.ClaudeRequest) (any, error) {
	claudeAdaptor := claude.Adaptor{}
	if _, err := claudeAdaptor.ConvertClaudeRequest(c, info, request); err != nil {
		return nil, err
	}
	for i, message := range request.Messages {
		updated := false
		if !message.IsStringContent() {
			content, err := message.ParseContent()
			if err != nil {
				return nil, errors.Wrap(err, "failed to parse message content")
			}
			for i2, mediaMessage := range content {
				if mediaMessage.Source != nil {
					if mediaMessage.Source.Type == "url" {
						// 使用统一的文件服务获取图片数据
						source := types.NewURLFileSource(mediaMessage.Source.Url)
						base64Data, mimeType, err := service.GetBase64Data(c, source, "formatting image for Claude")
						if err != nil {
							return nil, fmt.Errorf("get file base64 from url failed: %s", err.Error())
						}
						mediaMessage.Source.MediaType = mimeType
						mediaMessage.Source.Data = base64Data
						mediaMessage.Source.Url = ""
						mediaMessage.Source.Type = "base64"
						content[i2] = mediaMessage
						updated = true
					}
				}
			}
			if updated {
				message.SetContent(content)
			}
		}
		if updated {
			request.Messages[i] = message
		}
	}
	return request, nil
}

func (a *Adaptor) Init(info *relaycommon.RelayInfo) {
}

// GetRequestURL returns no URL for any format: this channel hands the request to
// the AWS SDK, which builds the Bedrock endpoint from the region inside the channel
// key (see newAwsClient). The two key shapes are both credential material the SDK
// consumes -- <api-key>|<region> becomes a bearer token provider, <ak>|<sk>|<region>
// becomes SigV4 credentials -- so neither of them has an endpoint of its own here.
// The endpoint is InvokeModel's, POST /model/{id}/invoke (streaming:
// /invoke-with-response-stream), with the Anthropic Messages body this package
// builds and anthropic_version stamped on it.
func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return "", nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	// Authentication is the SDK's business: it signs with the credentials or sends
	// the bearer token newAwsClient built. What is left here feeds formatRequest,
	// which reads the Anthropic headers out of the map it is given.
	claude.CommonClaudeHeadersOperation(c, req, info)
	return nil
}

// ConvertGeminiRequest serves the Gemini format the way this channel serves the
// chat format: Bedrock takes the Anthropic Messages body that this channel's own
// ConvertOpenAIRequest builds (it stamps anthropic_version on it in AKSK mode),
// and the response half needs nothing new because the Claude handlers it already
// delegates to are format-aware. Nova is the exception: that branch is built from
// a chat request alone and answers in the OpenAI shape without streaming, so a
// Gemini client stays refused on a Nova model instead of receiving the wrong
// protocol with a 200.
func (a *Adaptor) ConvertGeminiRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeminiChatRequest) (any, error) {
	if isNovaModel(info.UpstreamModelName) {
		return a.Unsupported.ConvertGeminiRequest(c, info, request)
	}
	return openai.ConvertToChannelOpenAIRequest(c, info, request, a.ConvertOpenAIRequest)
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if request == nil {
		return nil, errors.New("request is nil")
	}
	// 检查是否为Nova模型
	if isNovaModel(request.Model) {
		novaReq := convertToNovaRequest(request)
		a.IsNova = true
		return novaReq, nil
	}

	// 原有的Claude模型处理逻辑
	result, err := service.ConvertRequest(c, info, types.RelayFormatClaude, request)
	if err != nil {
		return nil, errors.Wrap(err, "failed to convert openai request to claude request")
	}
	claudeReq, ok := result.Value.(*dto.ClaudeRequest)
	if !ok {
		return nil, fmt.Errorf("expected Anthropic Messages request, got %T", result.Value)
	}
	info.UpstreamModelName = claudeReq.Model
	return claudeReq, err
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (any, error) {
	return doAwsClientRequest(c, info, a, requestBody)
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if a.IsNova {
		err, usage = handleNovaRequest(c, info, a)
	} else if info.IsStream {
		err, usage = awsStreamHandler(c, info, a)
	} else {
		err, usage = awsHandler(c, info, a)
	}
	return
}

func (a *Adaptor) GetModelList() (models []string) {
	for n := range awsModelIDMap {
		models = append(models, n)
	}

	return
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
