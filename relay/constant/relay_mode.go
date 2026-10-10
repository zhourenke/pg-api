package constant

import (
	"strings"

	rootconstant "github.com/zhourenke/pg-api/constant"
)

const (
	RelayModeUnknown = iota
	RelayModeChatCompletions
	RelayModeCompletions
	RelayModeEmbeddings
	RelayModeModerations
	RelayModeImagesGenerations
	RelayModeImagesEdits
	RelayModeEdits

	RelayModeAudioSpeech        // tts
	RelayModeAudioTranscription // whisper
	RelayModeAudioTranslation   // whisper

	RelayModeRerank

	RelayModeResponses

	RelayModeRealtime

	RelayModeGemini

	RelayModeResponsesCompact

	RelayModeAlphaSearch
)

// PlaygroundPathPrefix is the route prefix the web playground posts to. It
// reuses the public /v1 request shapes, so any rule that reasons about the
// request path must judge it by the public form: channels declare their routes
// with /v1 paths, and a /pg path matches none of them.
const PlaygroundPathPrefix = "/pg"

// PublicRequestPath maps an internal playground path to the public API path it
// behaves as, and returns every other path unchanged.
func PublicRequestPath(path string) string {
	if rest, ok := strings.CutPrefix(path, PlaygroundPathPrefix); ok && (rest == "" || strings.HasPrefix(rest, "/")) {
		return "/v1" + rest
	}
	return path
}

// RequiredFormatForPath reports the request format a request to this path is
// converted in, so channel selection can prefer channels that can convert it. A
// path that converts the universal OpenAI chat shape reports false, as does any
// path the relay does not treat as a format.
func RequiredFormatForPath(path string) (rootconstant.RelayFormatCapability, bool) {
	publicPath := PublicRequestPath(path)
	if strings.HasPrefix(publicPath, "/v1/messages") {
		return rootconstant.CapabilityClaude, true
	}
	switch Path2RelayMode(publicPath) {
	case RelayModeGemini:
		return rootconstant.CapabilityGemini, true
	case RelayModeResponses, RelayModeResponsesCompact:
		return rootconstant.CapabilityOpenAIResponses, true
	case RelayModeEmbeddings:
		return rootconstant.CapabilityEmbedding, true
	case RelayModeImagesGenerations, RelayModeImagesEdits:
		return rootconstant.CapabilityImage, true
	case RelayModeAudioSpeech, RelayModeAudioTranscription, RelayModeAudioTranslation:
		return rootconstant.CapabilityAudio, true
	case RelayModeRerank:
		return rootconstant.CapabilityRerank, true
	default:
		// Chat, completions, moderations and realtime all convert the universal
		// OpenAI chat shape, which every channel serves.
		return rootconstant.CapabilityClaude, false
	}
}

func Path2RelayMode(path string) int {
	relayMode := RelayModeUnknown
	if strings.HasPrefix(PublicRequestPath(path), "/v1/chat/completions") {
		relayMode = RelayModeChatCompletions
	} else if strings.HasPrefix(path, "/v1/completions") {
		relayMode = RelayModeCompletions
	} else if strings.HasPrefix(path, "/v1/embeddings") {
		relayMode = RelayModeEmbeddings
	} else if strings.HasSuffix(path, "embeddings") {
		relayMode = RelayModeEmbeddings
	} else if strings.HasPrefix(path, "/v1/moderations") {
		relayMode = RelayModeModerations
	} else if strings.HasPrefix(path, "/v1/images/generations") {
		relayMode = RelayModeImagesGenerations
	} else if strings.HasPrefix(path, "/v1/images/edits") {
		relayMode = RelayModeImagesEdits
	} else if strings.HasPrefix(path, "/v1/edits") {
		relayMode = RelayModeEdits
	} else if strings.HasPrefix(path, "/v1/responses/compact") {
		relayMode = RelayModeResponsesCompact
	} else if strings.HasPrefix(path, "/v1/responses") {
		relayMode = RelayModeResponses
	} else if strings.HasPrefix(path, "/v1/alpha/search") {
		relayMode = RelayModeAlphaSearch
	} else if strings.HasPrefix(path, "/v1/audio/speech") {
		relayMode = RelayModeAudioSpeech
	} else if strings.HasPrefix(path, "/v1/audio/transcriptions") {
		relayMode = RelayModeAudioTranscription
	} else if strings.HasPrefix(path, "/v1/audio/translations") {
		relayMode = RelayModeAudioTranslation
	} else if strings.HasPrefix(path, "/v1/rerank") {
		relayMode = RelayModeRerank
	} else if strings.HasPrefix(path, "/v1/realtime") {
		relayMode = RelayModeRealtime
	} else if strings.HasPrefix(path, "/v1beta/models") || strings.HasPrefix(path, "/v1/models") {
		relayMode = RelayModeGemini
	}
	return relayMode
}
