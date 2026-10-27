package channel

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	pgcommon "github.com/zhourenke/pg-api/common"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/service"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

// conversationContext builds a relay attempt whose body is cached the way the
// relay middleware caches it before any upstream request is constructed.
func conversationContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	storage, err := pgcommon.CreateBodyStorage([]byte(body))
	require.NoError(t, err)
	t.Cleanup(func() { _ = storage.Close() })
	ctx.Set(pgcommon.KeyBodyStorage, storage)
	return ctx
}

func conversationHeaders(t *testing.T, info *relaycommon.RelayInfo, ctx *gin.Context) map[string]string {
	t.Helper()
	if info.ChannelMeta == nil {
		info.ChannelMeta = &relaycommon.ChannelMeta{}
	}
	info.ChannelMeta.HeadersOverride = map[string]any{
		"x-opencode-session": "{conversation_id}",
	}
	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	return headers
}

func TestProcessHeaderOverride_ConversationIDFollowsTheConversation(t *testing.T) {
	t.Parallel()

	// Turn 1 and turn 5 of one conversation: the opening bytes repeat, the tail
	// grows. Another conversation diverges early. Every attempt starts from a
	// fresh RelayInfo, exactly like a separate downstream request.
	first := `{"model":"glm-5.3","messages":[{"role":"user","content":"explain reflog"}]}`
	fifth := `{"model":"glm-5.3","messages":[{"role":"user","content":"explain reflog"},` +
		`{"role":"assistant","content":"reflog tracks where HEAD has been"},` +
		`{"role":"user","content":"and now?"}]}`
	other := `{"model":"glm-5.3","messages":[{"role":"user","content":"write a haiku"}]}`

	firstHeaders := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, first))
	require.Contains(t, firstHeaders, "x-opencode-session")
	id := firstHeaders["x-opencode-session"]
	require.NotEmpty(t, id)

	fifthHeaders := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, fifth))
	assert.Equal(t, id, fifthHeaders["x-opencode-session"], "later turns of one conversation keep the identity")

	otherHeaders := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, other))
	assert.NotEqual(t, id, otherHeaders["x-opencode-session"], "a different conversation gets its own identity")

	// The identity is a pure function of token and body, so it survives a
	// gateway restart and a replayed attempt.
	repeated := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, first))
	assert.Equal(t, id, repeated["x-opencode-session"])

	// Two tokens must not share an affinity bucket even for identical requests.
	otherToken := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 8}, conversationContext(t, first))
	assert.NotEqual(t, id, otherToken["x-opencode-session"])
}

func TestProcessHeaderOverride_ConversationIDPrefersTheClientValue(t *testing.T) {
	t.Parallel()

	ctx := conversationContext(t, `{"model":"glm-5.3","messages":[]}`)
	ctx.Request.Header.Set("X-Conversation-Id", "client-conv-9")
	info := &relaycommon.RelayInfo{TokenId: 7}

	headers := conversationHeaders(t, info, ctx)
	require.Equal(t, "client-conv-9", headers["x-opencode-session"])
	assert.Equal(t, "client-conv-9", info.ConversationID, "the resolved identity is cached on the attempt")
}

func TestProcessHeaderOverride_ConversationIDIgnoresWhatLaterTurnsAppend(t *testing.T) {
	t.Parallel()

	// A system prompt far longer than any byte prefix would cover, followed by the
	// first user turn. Later turns append to the array and change the body length,
	// which must not move the identity.
	system := strings.Repeat("You are a careful reviewer of database migrations. ", 400)
	turn1 := `{"model":"glm-5.3","messages":[{"role":"system","content":"` + system + `"},` +
		`{"role":"user","content":"why did the lock wait grow"}]}`
	turn4 := `{"model":"glm-5.3","messages":[{"role":"system","content":"` + system + `"},` +
		`{"role":"user","content":"why did the lock wait grow"},` +
		`{"role":"assistant","content":"because the index changed"},` +
		`{"role":"user","content":"show the plan"}]}`

	require.Greater(t, len(turn4), 8192, "the fixture must exceed any fixed byte window")
	first := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, turn1))
	later := conversationHeaders(t, &relaycommon.RelayInfo{TokenId: 7}, conversationContext(t, turn4))
	require.Contains(t, first, "x-opencode-session")
	assert.Equal(t, first["x-opencode-session"], later["x-opencode-session"])
}

func TestProcessHeaderOverride_ConversationIDFallsBackToTheChannel(t *testing.T) {
	t.Parallel()

	// No conversation identity is derivable without a body and without a client
	// header. Omitting the header would make the upstream reject the request, so
	// the fallback stays inside this channel instead.
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)

	info := &relaycommon.RelayInfo{TokenId: 7, ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 12}}
	headers := conversationHeaders(t, info, ctx)
	assert.Equal(t, "pgapi-channel-12", headers["x-opencode-session"])
}

func TestProcessHeaderOverride_ApiKeyAndConversationIDCompose(t *testing.T) {
	t.Parallel()

	ctx := conversationContext(t, `{"model":"glm-5.3","messages":[]}`)
	info := &relaycommon.RelayInfo{
		TokenId: 7,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey: "sk-upstream",
			HeadersOverride: map[string]any{
				"Authorization":      "Bearer {api_key}",
				"x-opencode-session": "{conversation_id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Bearer sk-upstream", headers["authorization"])
	require.NotEmpty(t, headers["x-opencode-session"])
	assert.NotContains(t, headers["x-opencode-session"], "{", "the placeholder must not survive into the header")
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("{}"))
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}

// slowHeadersUpstream answers only after the delay, like an upstream that is
// still thinking before it opens the stream.
func slowHeadersUpstream(t *testing.T, delay time.Duration) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(delay):
		case <-r.Context().Done():
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {}\n\n"))
	}))
	t.Cleanup(server.Close)
	return server
}

func TestDoRequestBoundsTheResponsesStreamHeaderWait(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previous := operation_setting.FirstTokenTimeoutSeconds
	operation_setting.FirstTokenTimeoutSeconds = 1
	t.Cleanup(func() { operation_setting.FirstTokenTimeoutSeconds = previous })

	const upstreamDelay = 1200 * time.Millisecond
	upstream := slowHeadersUpstream(t, upstreamDelay)

	newContext := func(t *testing.T) *gin.Context {
		t.Helper()
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("{}"))
		return ctx
	}
	attemptOf := func(format types.RelayFormat) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			RelayFormat:      format,
			IsStream:         true,
			AttemptStartTime: time.Now(),
			ChannelMeta:      &relaycommon.ChannelMeta{},
		}
	}

	t.Run("responses stream", func(t *testing.T) {
		ctx := newContext(t)
		req, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, upstream.URL, strings.NewReader("{}"))
		require.NoError(t, err)

		started := time.Now()
		resp, err := DoRequest(ctx, req, attemptOf(types.RelayFormatOpenAIResponses))
		elapsed := time.Since(started)

		require.Nil(t, resp)
		var apiErr *types.NewAPIError
		require.ErrorAs(t, err, &apiErr)
		assert.Equal(t, types.ErrorCodeBadResponse, apiErr.GetErrorCode())
		assert.Equal(t, http.StatusInternalServerError, apiErr.StatusCode)
		assert.Contains(t, apiErr.Error(), "first token timeout")
		assert.GreaterOrEqual(t, elapsed, 900*time.Millisecond)
		assert.Less(t, elapsed, upstreamDelay, "the budget must cut the wait instead of inheriting it")
		assert.Equal(t, "retry", service.DecideRelayRetry(ctx, apiErr, 1).Action,
			"the attempt produced nothing, so another channel may serve the request")
	})

	t.Run("chat stream keeps waiting", func(t *testing.T) {
		ctx := newContext(t)
		req, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, upstream.URL, strings.NewReader("{}"))
		require.NoError(t, err)

		resp, err := DoRequest(ctx, req, attemptOf(types.RelayFormatOpenAI))
		require.NoError(t, err)
		require.NotNil(t, resp)
		defer func() { _ = resp.Body.Close() }()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	// Only the wait is budgeted: a stream that answered in time must survive
	// past the deadline, so the cancelled context cannot travel with the body.
	t.Run("answering stream outlives the budget", func(t *testing.T) {
		streaming := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("data: first\n\n"))
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			time.Sleep(600 * time.Millisecond)
			_, _ = w.Write([]byte("data: second\n\n"))
		}))
		t.Cleanup(streaming.Close)

		ctx := newContext(t)
		req, err := http.NewRequestWithContext(ctx.Request.Context(), http.MethodPost, streaming.URL, strings.NewReader("{}"))
		require.NoError(t, err)

		resp, err := DoRequest(ctx, req, attemptOf(types.RelayFormatOpenAIResponses))
		require.NoError(t, err)
		require.NotNil(t, resp)
		defer func() { _ = resp.Body.Close() }()

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		assert.Contains(t, string(body), "second")
	})
}

func TestToWebSocketURL(t *testing.T) {
	for input, want := range map[string]string{
		"https://api.openai.com/v1/responses":             "wss://api.openai.com/v1/responses",
		"http://127.0.0.1:3000/v1/responses":              "ws://127.0.0.1:3000/v1/responses",
		"wss://chatgpt.com/backend-api/codex/responses":   "wss://chatgpt.com/backend-api/codex/responses",
		"ws://127.0.0.1:3000/backend-api/codex/responses": "ws://127.0.0.1:3000/backend-api/codex/responses",
	} {
		assert.Equal(t, want, toWebSocketURL(input), input)
	}
}
