package constant

// RelayFormatCapability identifies one request format a channel can convert.
// There is one value per channel.Adaptor conversion method; the plain OpenAI
// chat format is universal and therefore has no bit.
type RelayFormatCapability int

const (
	CapabilityClaude RelayFormatCapability = iota
	CapabilityGemini
	CapabilityOpenAIResponses
	CapabilityAudio
	CapabilityImage
	CapabilityEmbedding
	CapabilityRerank
)

var capabilityNames = [...]string{
	CapabilityClaude:          "claude",
	CapabilityGemini:          "gemini",
	CapabilityOpenAIResponses: "openai-responses",
	CapabilityAudio:           "audio",
	CapabilityImage:           "image",
	CapabilityEmbedding:       "embedding",
	CapabilityRerank:          "rerank",
}

// String returns the format's short name, for logs and test failures.
func (c RelayFormatCapability) String() string {
	if c < 0 || int(c) >= len(capabilityNames) {
		return "unknown"
	}
	return capabilityNames[c]
}

// Capabilities is a set of RelayFormatCapability bits.
type Capabilities uint8

// Has reports whether the set contains the format.
func (c Capabilities) Has(format RelayFormatCapability) bool {
	return c&(1<<uint(format)) != 0
}

// CapabilitiesOf builds a set from the formats it contains.
func CapabilitiesOf(formats ...RelayFormatCapability) Capabilities {
	var caps Capabilities
	for _, format := range formats {
		caps |= 1 << uint(format)
	}
	return caps
}

// ChannelCapabilitiesByAPIType declares, per adaptor api type, the request
// formats that adaptor really converts instead of refusing through
// channel.Unsupported. The declaration mirrors the code; relay/capabilities_test.go
// derives the same matrix by calling every conversion and fails when the two
// disagree, so an adaptor that gains or loses a conversion cannot leave this
// table stale.
//
// Two api types are deliberately absent, because no static answer is correct:
// APITypeAdvancedCustom (including vllm and sglang) declares its routes per
// channel in the channel settings, and APITypeTencent picks a native or an
// OpenAI-compatible adaptor from the key format at request time. An absent entry
// means "no claim", never "supports nothing".
var ChannelCapabilitiesByAPIType = map[int]Capabilities{
	APITypeOpenAI:      CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityAudio, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeAnthropic:   CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses),
	APITypePaLM:        CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeBaidu:       CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityEmbedding),
	APITypeZhipu:       CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeAli:         CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeXunfei:      0,
	APITypeGemini:      CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage, CapabilityEmbedding),
	APITypeZhipuV4:     CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage, CapabilityEmbedding),
	APITypeOllama:      CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityEmbedding),
	APITypePerplexity:  CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses),
	APITypeAws:         CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeCohere:      CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityRerank),
	APITypeDify:        CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeJina:        CapabilitiesOf(CapabilityEmbedding, CapabilityRerank),
	APITypeCloudflare:  CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityAudio, CapabilityEmbedding),
	APITypeSiliconFlow: CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityAudio, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeVertexAi:    CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityImage),
	APITypeMistral:     CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeDeepSeek:    CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses),
	APITypeMokaAI:      CapabilitiesOf(CapabilityEmbedding),
	APITypeVolcEngine:  CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityAudio, CapabilityImage, CapabilityEmbedding),
	APITypeBaiduV2:     CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeOpenRouter:  CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityAudio, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeXinference:  CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityAudio, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeXai:         CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage),
	APITypeCoze:        0,
	APITypeJimeng:      CapabilitiesOf(CapabilityImage),
	APITypeMoonshot:    CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityImage, CapabilityEmbedding, CapabilityRerank),
	APITypeSubmodel:    CapabilitiesOf(CapabilityClaude, CapabilityGemini),
	APITypeMiniMax:     CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityAudio, CapabilityImage, CapabilityEmbedding),
	APITypeReplicate:   CapabilitiesOf(CapabilityImage),
	APITypeCodex:       CapabilitiesOf(CapabilityOpenAIResponses),
	APITypeSub2API:     CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage, CapabilityEmbedding),
	APITypeNewAPI:      CapabilitiesOf(CapabilityClaude, CapabilityGemini, CapabilityOpenAIResponses, CapabilityImage, CapabilityEmbedding),
}
