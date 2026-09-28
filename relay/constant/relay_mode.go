package constant

import (
	"strings"
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
