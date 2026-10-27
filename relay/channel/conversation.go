package channel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	common2 "github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/relay/common"
)

// conversationIDHeaders are the request headers a client may already use to name
// its own conversation; the first non-empty one wins over the derived identity.
var conversationIDHeaders = []string{"Session_id", "X-Session-Id", "X-Conversation-Id", "X-Opencode-Session"}

// conversationProbe holds the fields that can carry the first user-authored text
// across the request shapes this gateway relays: OpenAI chat and Anthropic
// messages, OpenAI responses input, and Gemini contents.
type conversationProbe struct {
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
	Contents []struct {
		Role  string `json:"role"`
		Parts []struct {
			Text string `json:"text"`
		} `json:"parts"`
	} `json:"contents"`
	Input json.RawMessage `json:"input"`
}

// deriveConversationID returns the identity this attempt belongs to, derived
// once per attempt and cached on the RelayInfo because several upstream headers
// may reference it.
//
// Resolution order: an explicit client conversation header, then the earliest
// user-authored text of the request, then a channel-scoped constant. The result
// is a routing hint for upstreams that pin affinity to a conversation, never an
// authorization decision: every branch yields a value the upstream accepts, so a
// wrong guess costs affinity and never a failed request.
func deriveConversationID(info *common.RelayInfo, c *gin.Context) (string, bool) {
	if info == nil || info.ChannelMeta == nil || c == nil || c.Request == nil {
		return "", false
	}
	if info.ConversationID != "" {
		return info.ConversationID, true
	}
	for _, name := range conversationIDHeaders {
		if value := strings.TrimSpace(c.Request.Header.Get(name)); value != "" {
			info.ConversationID = value
			return value, true
		}
	}

	anchor := conversationAnchor(requestBodyForFingerprint(c))
	if anchor == "" {
		// Nothing to tell conversations apart: keep one stable bucket per channel
		// instead of omitting the header, which upstreams reject outright.
		info.ConversationID = "pgapi-channel-" + strconv.Itoa(info.ChannelId)
		return info.ConversationID, true
	}

	hash := sha256.New()
	_, _ = io.WriteString(hash, strconv.Itoa(info.TokenId))
	_, _ = hash.Write([]byte{0})
	_, _ = io.WriteString(hash, anchor)
	info.ConversationID = "pgapi-" + hex.EncodeToString(hash.Sum(nil)[:16])
	return info.ConversationID, true
}

// requestBodyForFingerprint reuses a body the relay already cached. It must never
// create that cache: a body already handed to net/http would be consumed here and
// the upstream call would lose it.
func requestBodyForFingerprint(c *gin.Context) []byte {
	cached, exists := c.Get(common2.KeyBodyStorage)
	if !exists {
		return nil
	}
	storage, ok := cached.(common2.BodyStorage)
	if !ok {
		return nil
	}
	reader, err := storage.NewReader()
	if err != nil {
		return nil
	}
	defer func() { _ = reader.Close() }()
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil
	}
	return body
}

// conversationAnchor returns the earliest user-authored text of the request.
// Every later turn of one conversation repeats it verbatim, so it stays stable
// while a different conversation almost always starts differently. Decoding the
// whole body costs one extra unmarshal and only happens when a channel actually
// references {conversation_id}.
func conversationAnchor(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var probe conversationProbe
	if err := common2.Unmarshal(body, &probe); err != nil {
		return ""
	}
	for _, message := range probe.Messages {
		if !strings.EqualFold(strings.TrimSpace(message.Role), "user") {
			continue
		}
		if text := jsonText(message.Content); text != "" {
			return text
		}
	}
	for _, content := range probe.Contents {
		if role := strings.TrimSpace(content.Role); role != "" && !strings.EqualFold(role, "user") {
			continue
		}
		for _, part := range content.Parts {
			if text := strings.TrimSpace(part.Text); text != "" {
				return text
			}
		}
	}
	return responsesInputText(probe.Input)
}

// responsesInputText reads a Responses API input, which is either a plain string
// or a list of message items.
func responsesInputText(raw json.RawMessage) string {
	if text := jsonText(raw); text != "" {
		return text
	}
	var items []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	}
	if err := common2.Unmarshal(raw, &items); err != nil {
		return ""
	}
	for _, item := range items {
		if role := strings.TrimSpace(item.Role); role != "" && !strings.EqualFold(role, "user") {
			continue
		}
		if text := jsonText(item.Content); text != "" {
			return text
		}
	}
	return ""
}

// jsonText reads message content that is either a plain string, a content object
// with a text field, or a list of typed parts carrying text.
func jsonText(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	if strings.HasPrefix(trimmed, `"`) {
		var text string
		if err := common2.Unmarshal(raw, &text); err != nil {
			return ""
		}
		return strings.TrimSpace(text)
	}
	if strings.HasPrefix(trimmed, "[") {
		var parts []json.RawMessage
		if err := common2.Unmarshal(raw, &parts); err != nil {
			return ""
		}
		for _, part := range parts {
			if text := jsonText(part); text != "" {
				return text
			}
		}
		return ""
	}
	var object struct {
		Text string `json:"text"`
	}
	if err := common2.Unmarshal(raw, &object); err != nil {
		return ""
	}
	return strings.TrimSpace(object.Text)
}
