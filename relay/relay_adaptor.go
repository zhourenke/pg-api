package relay

import (
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/relay/channel"
	"github.com/zhourenke/pg-api/relay/channel/advancedcustom"
	"github.com/zhourenke/pg-api/relay/channel/ali"
	"github.com/zhourenke/pg-api/relay/channel/aws"
	"github.com/zhourenke/pg-api/relay/channel/baidu"
	"github.com/zhourenke/pg-api/relay/channel/baidu_v2"
	"github.com/zhourenke/pg-api/relay/channel/claude"
	"github.com/zhourenke/pg-api/relay/channel/cloudflare"
	"github.com/zhourenke/pg-api/relay/channel/codex"
	"github.com/zhourenke/pg-api/relay/channel/cohere"
	"github.com/zhourenke/pg-api/relay/channel/coze"
	"github.com/zhourenke/pg-api/relay/channel/deepseek"
	"github.com/zhourenke/pg-api/relay/channel/dify"
	"github.com/zhourenke/pg-api/relay/channel/gemini"
	"github.com/zhourenke/pg-api/relay/channel/jimeng"
	"github.com/zhourenke/pg-api/relay/channel/jina"
	"github.com/zhourenke/pg-api/relay/channel/minimax"
	"github.com/zhourenke/pg-api/relay/channel/mistral"
	"github.com/zhourenke/pg-api/relay/channel/mokaai"
	"github.com/zhourenke/pg-api/relay/channel/moonshot"
	"github.com/zhourenke/pg-api/relay/channel/newapi"
	"github.com/zhourenke/pg-api/relay/channel/ollama"
	"github.com/zhourenke/pg-api/relay/channel/openai"
	"github.com/zhourenke/pg-api/relay/channel/palm"
	"github.com/zhourenke/pg-api/relay/channel/perplexity"
	"github.com/zhourenke/pg-api/relay/channel/replicate"
	"github.com/zhourenke/pg-api/relay/channel/siliconflow"
	"github.com/zhourenke/pg-api/relay/channel/sub2api"
	"github.com/zhourenke/pg-api/relay/channel/submodel"
	"github.com/zhourenke/pg-api/relay/channel/tencent"
	"github.com/zhourenke/pg-api/relay/channel/vertex"
	"github.com/zhourenke/pg-api/relay/channel/volcengine"
	"github.com/zhourenke/pg-api/relay/channel/xai"
	"github.com/zhourenke/pg-api/relay/channel/xunfei"
	"github.com/zhourenke/pg-api/relay/channel/zhipu"
	"github.com/zhourenke/pg-api/relay/channel/zhipu_4v"
)

func GetAdaptor(apiType int) channel.Adaptor {
	switch apiType {
	case constant.APITypeAli:
		return &ali.Adaptor{}
	case constant.APITypeAnthropic:
		return &claude.Adaptor{}
	case constant.APITypeBaidu:
		return &baidu.Adaptor{}
	case constant.APITypeGemini:
		return &gemini.Adaptor{}
	case constant.APITypeOpenAI:
		return &openai.Adaptor{}
	case constant.APITypePaLM:
		return &palm.Adaptor{}
	case constant.APITypeTencent:
		return &tencent.DispatchAdaptor{}
	case constant.APITypeXunfei:
		return &xunfei.Adaptor{}
	case constant.APITypeZhipu:
		return &zhipu.Adaptor{}
	case constant.APITypeZhipuV4:
		return &zhipu_4v.Adaptor{}
	case constant.APITypeOllama:
		return &ollama.Adaptor{}
	case constant.APITypePerplexity:
		return &perplexity.Adaptor{}
	case constant.APITypeAws:
		return &aws.Adaptor{}
	case constant.APITypeCohere:
		return &cohere.Adaptor{}
	case constant.APITypeDify:
		return &dify.Adaptor{}
	case constant.APITypeJina:
		return &jina.Adaptor{}
	case constant.APITypeCloudflare:
		return &cloudflare.Adaptor{}
	case constant.APITypeSiliconFlow:
		return &siliconflow.Adaptor{}
	case constant.APITypeVertexAi:
		return &vertex.Adaptor{}
	case constant.APITypeMistral:
		return &mistral.Adaptor{}
	case constant.APITypeDeepSeek:
		return &deepseek.Adaptor{}
	case constant.APITypeMokaAI:
		return &mokaai.Adaptor{}
	case constant.APITypeVolcEngine:
		return &volcengine.Adaptor{}
	case constant.APITypeBaiduV2:
		return &baidu_v2.Adaptor{}
	case constant.APITypeOpenRouter:
		return &openai.Adaptor{}
	case constant.APITypeXinference:
		return &openai.Adaptor{}
	case constant.APITypeXai:
		return &xai.Adaptor{}
	case constant.APITypeCoze:
		return &coze.Adaptor{}
	case constant.APITypeJimeng:
		return &jimeng.Adaptor{}
	case constant.APITypeMoonshot:
		return &moonshot.Adaptor{} // Moonshot uses Claude API
	case constant.APITypeSubmodel:
		return &submodel.Adaptor{}
	case constant.APITypeMiniMax:
		return &minimax.Adaptor{}
	case constant.APITypeReplicate:
		return &replicate.Adaptor{}
	case constant.APITypeCodex:
		return &codex.Adaptor{}
	case constant.APITypeAdvancedCustom:
		return &advancedcustom.Adaptor{}
	case constant.APITypeSub2API:
		return &sub2api.Adaptor{}
	case constant.APITypeNewAPI:
		return &newapi.Adaptor{}
	}
	return nil
}


