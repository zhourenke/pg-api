package constant

import (
	"testing"

	"github.com/stretchr/testify/assert"
	rootconstant "github.com/zhourenke/pg-api/constant"
)

func TestRequiredFormatForPath(t *testing.T) {
	tests := []struct {
		path       string
		wantFormat rootconstant.RelayFormatCapability
		wantOK     bool
	}{
		{path: "/v1/messages", wantFormat: rootconstant.CapabilityClaude, wantOK: true},
		{path: "/pg/messages", wantFormat: rootconstant.CapabilityClaude, wantOK: true},
		{path: "/v1beta/models/gemini-2.5-pro:generateContent", wantFormat: rootconstant.CapabilityGemini, wantOK: true},
		{path: "/v1/responses", wantFormat: rootconstant.CapabilityOpenAIResponses, wantOK: true},
		{path: "/v1/responses/compact", wantFormat: rootconstant.CapabilityOpenAIResponses, wantOK: true},
		{path: "/v1/embeddings", wantFormat: rootconstant.CapabilityEmbedding, wantOK: true},
		{path: "/v1/images/generations", wantFormat: rootconstant.CapabilityImage, wantOK: true},
		{path: "/v1/images/edits", wantFormat: rootconstant.CapabilityImage, wantOK: true},
		{path: "/v1/audio/speech", wantFormat: rootconstant.CapabilityAudio, wantOK: true},
		{path: "/v1/audio/transcriptions", wantFormat: rootconstant.CapabilityAudio, wantOK: true},
		{path: "/v1/rerank", wantFormat: rootconstant.CapabilityRerank, wantOK: true},
		// The universal chat shape, and the playground posting it, need no
		// capability preference.
		{path: "/v1/chat/completions"},
		{path: "/pg/chat/completions"},
		{path: "/v1/completions"},
		{path: "/v1/moderations"},
		{path: "/v1/realtime"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			format, ok := RequiredFormatForPath(tt.path)
			assert.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				assert.Equal(t, tt.wantFormat, format)
			}
		})
	}
}

func TestPath2RelayMode(t *testing.T) {
	tests := []struct {
		path string
		want int
	}{
		{path: "/v1/alpha/search", want: RelayModeAlphaSearch},
		{path: "/v1/alpha/search?foo=1", want: RelayModeAlphaSearch},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			assert.Equal(t, tt.want, Path2RelayMode(tt.path))
		})
	}
}
