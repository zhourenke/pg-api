package baidu

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/samber/lo"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relay/helper"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"

	"github.com/gin-gonic/gin"
)

// https://cloud.baidu.com/doc/WENXINWORKSHOP/s/flfmc9do2

var baiduTokenStore sync.Map

func requestOpenAI2Baidu(request dto.GeneralOpenAIRequest) *BaiduChatRequest {
	baiduRequest := BaiduChatRequest{
		Temperature:    request.Temperature,
		TopP:           lo.FromPtrOr(request.TopP, 0),
		PenaltyScore:   lo.FromPtrOr(request.FrequencyPenalty, 0),
		Stream:         lo.FromPtrOr(request.Stream, false),
		DisableSearch:  false,
		EnableCitation: false,
		UserId:         request.User,
	}
	if request.GetMaxTokens() != 0 {
		maxTokens := int(request.GetMaxTokens())
		if request.GetMaxTokens() == 1 {
			maxTokens = 2
		}
		baiduRequest.MaxOutputTokens = &maxTokens
	}
	for _, message := range request.Messages {
		if message.Role == "system" {
			baiduRequest.System = message.StringContent()
		} else {
			baiduRequest.Messages = append(baiduRequest.Messages, BaiduMessage{
				Role:    message.Role,
				Content: message.StringContent(),
			})
		}
	}
	return &baiduRequest
}

func responseBaidu2OpenAI(response *BaiduChatResponse) *dto.OpenAITextResponse {
	choice := dto.OpenAITextResponseChoice{
		Index: 0,
		Message: dto.Message{
			Role:    "assistant",
			Content: response.Result,
		},
		FinishReason: "stop",
	}
	fullTextResponse := dto.OpenAITextResponse{
		Id:      response.Id,
		Object:  "chat.completion",
		Created: response.Created,
		Choices: []dto.OpenAITextResponseChoice{choice},
		Usage:   response.Usage,
	}
	return &fullTextResponse
}

// Every frame of a Baidu stream names the model that answered it; the model used
// to be the literal "ernie-bot" on all of them.
func streamResponseBaidu2OpenAI(baiduResponse *BaiduChatStreamResponse, model string) *dto.ChatCompletionsStreamResponse {
	var choice dto.ChatCompletionsStreamResponseChoice
	choice.Delta.SetContentString(baiduResponse.Result)
	if baiduResponse.IsEnd {
		choice.FinishReason = &constant.FinishReasonStop
	}
	response := dto.ChatCompletionsStreamResponse{
		Id:      baiduResponse.Id,
		Object:  "chat.completion.chunk",
		Created: baiduResponse.Created,
		Model:   model,
		Choices: []dto.ChatCompletionsStreamResponseChoice{choice},
	}
	return &response
}

func embeddingRequestOpenAI2Baidu(request dto.EmbeddingRequest) *BaiduEmbeddingRequest {
	return &BaiduEmbeddingRequest{
		Input: request.ParseInput(),
	}
}

func embeddingResponseBaidu2OpenAI(response *BaiduEmbeddingResponse) *dto.OpenAIEmbeddingResponse {
	openAIEmbeddingResponse := dto.OpenAIEmbeddingResponse{
		Object: "list",
		Data:   make([]dto.OpenAIEmbeddingResponseItem, 0, len(response.Data)),
		Model:  "baidu-embedding",
		Usage:  response.Usage,
	}
	for _, item := range response.Data {
		openAIEmbeddingResponse.Data = append(openAIEmbeddingResponse.Data, dto.OpenAIEmbeddingResponseItem{
			Object:    item.Object,
			Index:     item.Index,
			Embedding: item.Embedding,
		})
	}
	return &openAIEmbeddingResponse
}

// A client that asked in the Anthropic or the Gemini protocol gets that protocol
// back: this channel has no dialect of its own for either, so the chat response
// built here is the intermediate they are rendered from. The two formats are
// named instead of testing for "not OpenAI" because the embedding format shares
// this package and renders its own response, and both response handlers have to
// agree on the answer.
func isConvertedRelayFormat(info *relaycommon.RelayInfo) bool {
	switch info.RelayFormat {
	case types.RelayFormatClaude, types.RelayFormatGemini:
		return true
	}
	return false
}

// A Baidu stream is a run of frames holding answer text and one closing frame
// carrying is_end plus the usage. The OpenAI format keeps the frames it always
// sent, now closed with the [DONE] marker every other channel sends; a client
// that asked in another protocol gets that protocol back, rendered from the same
// chat chunks and closed on the last frame, which carries the finish reason and
// the usage together.
func baiduStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*types.NewAPIError, *dto.Usage) {
	usage := &dto.Usage{}
	lastStreamData := ""
	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var baiduResponse BaiduChatStreamResponse
		if err := common.Unmarshal([]byte(data), &baiduResponse); err != nil {
			common.SysLog("error unmarshalling stream response: " + err.Error())
			sr.Error(err)
			return
		}
		if baiduResponse.Usage.TotalTokens != 0 {
			usage.TotalTokens = baiduResponse.Usage.TotalTokens
			usage.PromptTokens = baiduResponse.Usage.PromptTokens
			usage.CompletionTokens = baiduResponse.Usage.TotalTokens - baiduResponse.Usage.PromptTokens
		}
		response := streamResponseBaidu2OpenAI(&baiduResponse, info.UpstreamModelName)
		if !isConvertedRelayFormat(info) {
			if err := helper.ObjectData(c, response); err != nil {
				common.SysLog("error sending stream response: " + err.Error())
				sr.Error(err)
			}
			return
		}
		if baiduResponse.IsEnd {
			response.Usage = usage
		}
		encoded, err := common.Marshal(response)
		if err != nil {
			common.SysLog("error marshalling stream response: " + err.Error())
			sr.Error(err)
			return
		}
		lastStreamData = string(encoded)
		if err := openai.HandleStreamFormat(c, info, lastStreamData, false, false); err != nil {
			common.SysLog("error converting stream response: " + err.Error())
			sr.Error(err)
		}
	})
	service.CloseResponseBodyGracefully(resp)
	if isConvertedRelayFormat(info) {
		// The converted formats end with their own closing event instead of a chat
		// [DONE], and the Claude path needs its per-stream state. A stream that
		// ended without a finishing frame is closed here.
		info.EnsureClaudeConvertInfo()
		openai.HandleFinalResponse(c, info, lastStreamData, helper.GetResponseID(c), common.GetTimestamp(), info.UpstreamModelName, "", usage, false)
		return nil, usage
	}
	helper.Done(c)
	return nil, usage
}

func baiduHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*types.NewAPIError, *dto.Usage) {
	var baiduResponse BaiduChatResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	service.CloseResponseBodyGracefully(resp)
	err = common.Unmarshal(responseBody, &baiduResponse)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	if baiduResponse.ErrorMsg != "" {
		return types.NewError(fmt.Errorf("%s", baiduResponse.ErrorMsg), types.ErrorCodeBadResponseBody), nil
	}
	fullTextResponse := responseBaidu2OpenAI(&baiduResponse)
	// The chat body is the intermediate the converted formats are rendered from,
	// and an empty model name is what it used to carry for every format.
	fullTextResponse.Model = info.UpstreamModelName
	var jsonResponse []byte
	if isConvertedRelayFormat(info) {
		convertResult, err := service.ConvertResponse(c, info, info.RelayFormat, fullTextResponse)
		if err != nil {
			return types.NewError(err, types.ErrorCodeBadResponseBody), nil
		}
		jsonResponse, err = common.Marshal(convertResult.Value)
		if err != nil {
			return types.NewError(err, types.ErrorCodeBadResponseBody), nil
		}
	} else {
		jsonResponse, err = common.Marshal(fullTextResponse)
		if err != nil {
			return types.NewError(err, types.ErrorCodeBadResponseBody), nil
		}
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	return nil, &fullTextResponse.Usage
}

func baiduEmbeddingHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*types.NewAPIError, *dto.Usage) {
	var baiduResponse BaiduEmbeddingResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	service.CloseResponseBodyGracefully(resp)
	err = common.Unmarshal(responseBody, &baiduResponse)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	if baiduResponse.ErrorMsg != "" {
		return types.NewError(fmt.Errorf("%s", baiduResponse.ErrorMsg), types.ErrorCodeBadResponseBody), nil
	}
	fullTextResponse := embeddingResponseBaidu2OpenAI(&baiduResponse)
	jsonResponse, err := common.Marshal(fullTextResponse)
	if err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody), nil
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	c.Writer.WriteHeader(resp.StatusCode)
	_, err = c.Writer.Write(jsonResponse)
	return nil, &fullTextResponse.Usage
}

func getBaiduAccessToken(apiKey string) (string, error) {
	if val, ok := baiduTokenStore.Load(apiKey); ok {
		var accessToken BaiduAccessToken
		if accessToken, ok = val.(BaiduAccessToken); ok {
			// soon this will expire
			if time.Now().Add(time.Hour).After(accessToken.ExpiresAt) {
				go func() {
					_, _ = getBaiduAccessTokenHelper(apiKey)
				}()
			}
			return accessToken.AccessToken, nil
		}
	}
	accessToken, err := getBaiduAccessTokenHelper(apiKey)
	if err != nil {
		return "", err
	}
	if accessToken == nil {
		return "", errors.New("getBaiduAccessToken return a nil token")
	}
	return (*accessToken).AccessToken, nil
}

func getBaiduAccessTokenHelper(apiKey string) (*BaiduAccessToken, error) {
	parts := strings.Split(apiKey, "|")
	if len(parts) != 2 {
		return nil, errors.New("invalid baidu apikey")
	}
	req, err := http.NewRequest("POST", fmt.Sprintf("https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=%s&client_secret=%s",
		parts[0], parts[1]), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Add("Content-Type", "application/json")
	req.Header.Add("Accept", "application/json")
	res, err := service.GetHttpClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	var accessToken BaiduAccessToken
	err = common.DecodeJson(res.Body, &accessToken)
	if err != nil {
		return nil, err
	}
	if accessToken.Error != "" {
		return nil, errors.New(accessToken.Error + ": " + accessToken.ErrorDescription)
	}
	if accessToken.AccessToken == "" {
		return nil, errors.New("getBaiduAccessTokenHelper get empty access token")
	}
	accessToken.ExpiresAt = time.Now().Add(time.Duration(accessToken.ExpiresIn) * time.Second)
	baiduTokenStore.Store(apiKey, accessToken)
	return &accessToken, nil
}
