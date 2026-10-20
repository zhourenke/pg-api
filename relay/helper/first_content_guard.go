package helper

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhourenke/pg-api/logger"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

// ErrFirstContentTimeout marks the read that failed because a FirstContentGuard
// closed the upstream body when one of its budgets expired. Surfacing it as a
// distinct error is what lets the stream scanner record `timeout` instead of a
// generic read error.
var ErrFirstContentTimeout = errors.New("first content timeout")

// FirstContentGuard aborts a Responses stream attempt that has not produced its
// first content event in time. It replaces the upstream body in place, so the
// stream scanner reads through it, and it closes that body when a budget
// expires: closing is what unblocks a reader stuck in Read.
//
// The first content event claims the attempt. MarkContent stops both budgets,
// and a budget that expires later finds the content already seen and does
// nothing, so a slow but healthy stream is never cut after it started
// answering. Callers read Aborted once the stream ended and turn it into the
// API error that allows the relay to fail over to another channel; that is only
// legal while nothing has been written to the client.
type FirstContentGuard struct {
	body         io.ReadCloser
	context      *gin.Context
	tokenLimit   time.Duration
	contentLimit time.Duration
	tokenTimer   *time.Timer
	contentTimer *time.Timer
	stopOnce     sync.Once

	// mu serialises claiming the attempt. A budget and the first content event
	// can arrive in the same instant, and only one of them may win: if the
	// content is claimed first the body stays open, and if the budget wins the
	// caller fails over instead of streaming a truncated answer.
	mu          sync.Mutex
	fired       bool
	contentSeen bool
	tokenFired  bool
}

// GuardFirstContent wraps resp.Body with the budgets currently configured in the
// operation settings. It returns nil when both budgets are disabled, so a
// disabled guard costs callers a nil check and nothing else.
func GuardFirstContent(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) *FirstContentGuard {
	return newFirstContentGuard(
		c,
		info,
		resp,
		time.Duration(operation_setting.FirstTokenTimeoutSeconds)*time.Second,
		time.Duration(operation_setting.FirstContentTimeoutSeconds)*time.Second,
	)
}

// FirstTokenBudgetForAttempt reports how much of the first token budget the
// current attempt may still spend waiting for the upstream, or false when the
// budgets do not govern this request.
//
// The wait for the response headers counts towards it. The guard alone cannot
// enforce that: it is built from the response, so an attempt whose upstream never
// sends headers is not guarded at all and would only be bounded by
// RELAY_RESPONSE_HEADER_TIMEOUT (30 minutes by default). Callers therefore arm
// this budget before the upstream request and let the guard take over once the
// headers arrive.
func FirstTokenBudgetForAttempt(info *relaycommon.RelayInfo) (time.Duration, bool) {
	if info == nil || !info.IsStream || info.RelayFormat != types.RelayFormatOpenAIResponses {
		return 0, false
	}
	limit := time.Duration(operation_setting.FirstTokenTimeoutSeconds) * time.Second
	if limit <= 0 {
		return 0, false
	}
	return remainingFirstTokenBudget(info, limit), true
}

func remainingFirstTokenBudget(info *relaycommon.RelayInfo, limit time.Duration) time.Duration {
	var startedAt time.Time
	if info != nil {
		startedAt = info.AttemptStartTime
		if startedAt.IsZero() {
			startedAt = info.StartTime
		}
	}
	if startedAt.IsZero() {
		return limit
	}
	remaining := limit - time.Since(startedAt)
	if remaining < 0 {
		return 0
	}
	return remaining
}

func firstTokenTimeoutMessage(limit time.Duration) string {
	return fmt.Sprintf("first token timeout: the attempt produced no content within %s of the attempt start", limit)
}

func firstContentTimeoutMessage(limit time.Duration) string {
	return fmt.Sprintf("first content timeout: the stream produced no content within %s of opening", limit)
}

// newFirstContentGuard arms the budgets from explicit limits. A budget may
// already be spent when the stream opens late in its attempt.
func newFirstContentGuard(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response, tokenLimit, contentLimit time.Duration) *FirstContentGuard {
	if resp == nil || resp.Body == nil || tokenLimit <= 0 && contentLimit <= 0 {
		return nil
	}
	guard := &FirstContentGuard{
		body:         resp.Body,
		context:      c,
		tokenLimit:   tokenLimit,
		contentLimit: contentLimit,
	}
	resp.Body = guard
	if contentLimit > 0 {
		guard.contentTimer = time.AfterFunc(contentLimit, func() {
			guard.abort(firstContentTimeoutMessage(contentLimit), false)
		})
	}
	if tokenLimit > 0 {
		remaining := remainingFirstTokenBudget(info, tokenLimit)
		if remaining <= 0 {
			// The upstream spent the whole budget before the headers arrived.
			// Aborting here instead of arming a zero-delay timer is what keeps
			// the outcome deterministic: the timer would race the first content
			// event, and losing that race leaves a stream that was cut after it
			// started answering, which can no longer fail over.
			guard.abort(firstTokenTimeoutMessage(tokenLimit), true)
			return guard
		}
		guard.tokenTimer = time.AfterFunc(remaining, func() {
			guard.abort(firstTokenTimeoutMessage(tokenLimit), true)
		})
	}
	return guard
}

func (g *FirstContentGuard) Read(p []byte) (int, error) {
	n, err := g.body.Read(p)
	if err == nil || errors.Is(err, io.EOF) || !g.aborted() {
		return n, err
	}
	return n, fmt.Errorf("%w: %w", ErrFirstContentTimeout, err)
}

func (g *FirstContentGuard) Close() error {
	return g.body.Close()
}

// MarkContent records the first content event and stops both budgets.
func (g *FirstContentGuard) MarkContent() {
	if g == nil {
		return
	}
	g.mu.Lock()
	contentSeen := g.contentSeen
	g.contentSeen = true
	g.mu.Unlock()
	if contentSeen {
		return
	}
	g.stopTimers()
}

// Stop releases the budgets after the attempt ended, whether it produced
// content or not, so no timer closes a body the caller is about to reuse.
func (g *FirstContentGuard) Stop() {
	if g == nil {
		return
	}
	g.stopTimers()
}

// Aborted reports that a budget expired before any content was written, so the
// attempt may still be retried on another channel.
func (g *FirstContentGuard) Aborted() bool {
	if g == nil {
		return false
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.fired && !g.contentSeen
}

// TimeoutError describes the budget that aborted the attempt.
func (g *FirstContentGuard) TimeoutError() error {
	if !g.Aborted() {
		return nil
	}
	g.mu.Lock()
	tokenFired := g.tokenFired
	g.mu.Unlock()
	if tokenFired {
		return errors.New(firstTokenTimeoutMessage(g.tokenLimit))
	}
	return errors.New(firstContentTimeoutMessage(g.contentLimit))
}

func (g *FirstContentGuard) aborted() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.fired
}

// abort claims the attempt for the budget that expired first and closes the
// upstream body. Closing is best effort: the reader reports the resulting error
// through Read, which is where the timeout becomes visible to the scanner.
func (g *FirstContentGuard) abort(message string, tokenBudget bool) {
	g.mu.Lock()
	if g.contentSeen || g.fired {
		g.mu.Unlock()
		return
	}
	g.fired = true
	g.tokenFired = tokenBudget
	g.mu.Unlock()

	g.stopTimers()
	if g.context != nil {
		logger.LogWarn(g.context, message)
	}
	_ = g.body.Close()
}

func (g *FirstContentGuard) stopTimers() {
	g.stopOnce.Do(func() {
		if g.tokenTimer != nil {
			g.tokenTimer.Stop()
		}
		if g.contentTimer != nil {
			g.contentTimer.Stop()
		}
	})
}
