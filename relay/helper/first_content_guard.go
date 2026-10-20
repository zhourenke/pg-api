package helper

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zhourenke/pg-api/logger"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
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
	fired        atomic.Bool
	contentSeen  atomic.Bool
	tokenFired   atomic.Bool
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
			guard.abort(fmt.Sprintf("first content timeout: the stream produced no content within %s of opening", contentLimit), nil)
		})
	}
	if tokenLimit > 0 {
		remaining := tokenLimit
		if info != nil {
			// The budget restarts with every attempt: the relay sets
			// AttemptStartTime before it selects a channel, so a retry does not
			// inherit the time the previous attempt already spent.
			startedAt := info.AttemptStartTime
			if startedAt.IsZero() {
				startedAt = info.StartTime
			}
			if !startedAt.IsZero() {
				remaining = tokenLimit - time.Since(startedAt)
				if remaining < 0 {
					remaining = 0
				}
			}
		}
		guard.tokenTimer = time.AfterFunc(remaining, func() {
			guard.abort(fmt.Sprintf("first token timeout: the attempt produced no content within %s of the attempt start", tokenLimit), func() {
				guard.tokenFired.Store(true)
			})
		})
	}
	return guard
}

func (g *FirstContentGuard) Read(p []byte) (int, error) {
	n, err := g.body.Read(p)
	if err == nil || errors.Is(err, io.EOF) || !g.fired.Load() {
		return n, err
	}
	return n, fmt.Errorf("%w: %w", ErrFirstContentTimeout, err)
}

func (g *FirstContentGuard) Close() error {
	return g.body.Close()
}

// MarkContent records the first content event and stops both budgets.
func (g *FirstContentGuard) MarkContent() {
	if g == nil || !g.contentSeen.CompareAndSwap(false, true) {
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
	return g != nil && g.fired.Load() && !g.contentSeen.Load()
}

// TimeoutError describes the budget that aborted the attempt.
func (g *FirstContentGuard) TimeoutError() error {
	if !g.Aborted() {
		return nil
	}
	if g.tokenFired.Load() {
		return fmt.Errorf("first token timeout: the attempt produced no content within %s of the attempt start", g.tokenLimit)
	}
	return fmt.Errorf("first content timeout: the stream produced no content within %s of opening", g.contentLimit)
}

// abort claims the attempt for the budget that expired first and closes the
// upstream body. Closing is best effort: the reader reports the resulting error
// through Read, which is where the timeout becomes visible to the scanner.
func (g *FirstContentGuard) abort(message string, mark func()) {
	if g.contentSeen.Load() || !g.fired.CompareAndSwap(false, true) {
		return
	}
	if mark != nil {
		mark()
	}
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
