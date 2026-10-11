package aws

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

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

type ClientMode int

const (
	ClientModeApiKey ClientMode = iota + 1
	ClientModeAKSK
)

type Adaptor struct {
	channel.Unsupported
	ClientMode ClientMode
	AwsClient  *bedrockruntime.Client
	AwsModelId string
	AwsReq     any
	IsNova     bool
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

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info.ChannelOtherSettings.AwsKeyType == dto.AwsKeyTypeApiKey {
		// This branch is not the one a relay request takes: ClientMode is assigned
		// here and nowhere else, and this branch is the only caller of
		// channel.DoApiRequest, so an api_key channel reaches the SDK path in
		// DoRequest and is served by the bearer token provider newAwsClient builds
		// from the same two-part key. It is kept coherent with that path all the
		// same, because wiring it up as it used to be would have sent a request
		// Bedrock rejects.
		a.ClientMode = ClientModeApiKey
		awsSecret := strings.Split(info.ApiKey, "|")
		if len(awsSecret) != 2 {
			return "", errors.New("invalid aws api key, should be in format of <api-key>|<region>")
		}
		region := awsSecret[1]
		// InvokeModel's path, not Converse's: the body this channel builds is the
		// model-native Anthropic one, while Converse takes a schema of its own and
		// answers in a shape of its own.
		awsModelId := getAwsModelID(info.UpstreamModelName)
		regionPrefix := getAwsRegionPrefix(region)
		if awsModelCanCrossRegion(awsModelId, regionPrefix) {
			awsModelId = awsModelCrossRegion(awsModelId, regionPrefix)
		}
		return fmt.Sprintf("https://bedrock-runtime.%s.amazonaws.com/model/%s/invoke", region, url.PathEscape(awsModelId)), nil
	}
	a.ClientMode = ClientModeAKSK
	return "", nil
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, req *http.Header, info *relaycommon.RelayInfo) error {
	claude.CommonClaudeHeadersOperation(c, req, info)
	if a.ClientMode == ClientModeApiKey {
		// The channel key is <api-key>|<region>: the key half is the bearer token,
		// and GetRequestURL is what puts the region into the host.
		apiKey, _, _ := strings.Cut(info.ApiKey, "|")
		req.Set("Authorization", "Bearer "+apiKey)
		req.Set("Content-Type", "application/json")
	}
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
	if a.ClientMode == ClientModeApiKey {
		// See GetRequestURL: nothing assigns ClientMode before DoRequest, so this
		// branch is not reached today. The body preparation is the SDK path's, which
		// is what makes the plain-HTTP request carry the anthropic_version Bedrock
		// requires and no model/stream fields.
		body, err := prepareAwsInvokeBody(c, info, a, requestBody)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeBadRequestBody)
		}
		return channel.DoApiRequest(a, c, info, bytes.NewReader(body))
	} else {
		return doAwsClientRequest(c, info, a, requestBody)
	}
}

func (a *Adaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (usage any, err *types.NewAPIError) {
	if a.ClientMode == ClientModeApiKey {
		claudeAdaptor := claude.Adaptor{}
		usage, err = claudeAdaptor.DoResponse(c, resp, info)
	} else {
		if a.IsNova {
			err, usage = handleNovaRequest(c, info, a)
		} else {
			if info.IsStream {
				err, usage = awsStreamHandler(c, info, a)
			} else {
				err, usage = awsHandler(c, info, a)
			}
		}
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
