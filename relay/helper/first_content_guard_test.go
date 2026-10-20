package helper

import (
	"errors"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/setting/operation_setting"
)

// blockingBody answers like an upstream that accepted the stream and then said
// nothing: Read blocks until Close, which is what an aborted attempt does.
type blockingBody struct {
	closed chan struct{}
	once   sync.Once
}

func newBlockingBody() *blockingBody {
	return &blockingBody{closed: make(chan struct{})}
}

func (b *blockingBody) Read([]byte) (int, error) {
	<-b.closed
	return 0, errors.New("read on closed body")
}

func (b *blockingBody) Close() error {
	b.once.Do(func() { close(b.closed) })
	return nil
}

func TestFirstContentGuardAbortsAStreamThatNeverStartsAnswering(t *testing.T) {
	body := newBlockingBody()
	resp := &http.Response{Body: body}
	guard := newFirstContentGuard(nil, nil, resp, 20*time.Millisecond, 0)
	require.NotNil(t, guard)
	require.Same(t, guard, resp.Body, "the guard must sit in the read path so it can end the read")

	read := make(chan error, 1)
	go func() {
		_, err := io.ReadAll(resp.Body)
		read <- err
	}()

	select {
	case err := <-read:
		require.Error(t, err)
		assert.ErrorIs(t, err, ErrFirstContentTimeout, "the scanner needs the dedicated error to record a timeout")
	case <-time.After(5 * time.Second):
		t.Fatal("the expired budget did not close the upstream body")
	}
	assert.True(t, guard.Aborted())
	assert.Contains(t, guard.TimeoutError().Error(), "first token timeout")
}

func TestFirstContentGuardLeavesAStreamThatAnsweredAlone(t *testing.T) {
	body := newBlockingBody()
	guard := newFirstContentGuard(nil, nil, &http.Response{Body: body}, 20*time.Millisecond, 20*time.Millisecond)
	require.NotNil(t, guard)

	guard.MarkContent()
	require.Never(t, guard.Aborted, 100*time.Millisecond, 10*time.Millisecond,
		"the first content event claims the attempt before its budgets expire")
	assert.NoError(t, guard.TimeoutError())
	guard.Stop()
}

func TestFirstContentGuardStaysOutOfTheWayWhenBothBudgetsAreDisabled(t *testing.T) {
	body := newBlockingBody()
	resp := &http.Response{Body: body}

	require.Nil(t, newFirstContentGuard(nil, nil, resp, 0, 0))
	assert.Same(t, body, resp.Body, "a disabled guard must not wrap the body")
}

func TestFirstContentGuardAbortsAnAttemptWhoseBudgetWasSpentBeforeTheHeaders(t *testing.T) {
	body := newBlockingBody()
	resp := &http.Response{Body: body}
	info := &relaycommon.RelayInfo{AttemptStartTime: time.Now().Add(-time.Minute)}

	guard := newFirstContentGuard(nil, info, resp, time.Minute, time.Minute)
	require.NotNil(t, guard)
	assert.True(t, guard.Aborted(), "a stream that opens after its budget is gone must not start streaming")
	assert.Contains(t, guard.TimeoutError().Error(), "first token timeout")

	_, err := resp.Body.Read(make([]byte, 8))
	require.ErrorIs(t, err, ErrFirstContentTimeout)
}

func TestFirstContentGuardLeavesTheBodyOpenOnceContentIsClaimed(t *testing.T) {
	body := newBlockingBody()
	guard := newFirstContentGuard(nil, nil, &http.Response{Body: body}, time.Minute, time.Minute)
	require.NotNil(t, guard)

	guard.MarkContent()
	guard.abort("first content timeout: late budget", false)

	select {
	case <-body.closed:
		t.Fatal("a budget that expires after the first content event must not close the body")
	default:
	}
	assert.False(t, guard.Aborted())
}

func TestFirstTokenBudgetForAttemptOnlyGovernsResponsesStreams(t *testing.T) {
	previous := operation_setting.FirstTokenTimeoutSeconds
	operation_setting.FirstTokenTimeoutSeconds = 30
	t.Cleanup(func() { operation_setting.FirstTokenTimeoutSeconds = previous })

	infoFor := func(format types.RelayFormat, stream bool) *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{RelayFormat: format, IsStream: stream}
	}

	budget, ok := FirstTokenBudgetForAttempt(infoFor(types.RelayFormatOpenAIResponses, true))
	require.True(t, ok)
	assert.Equal(t, 30*time.Second, budget)

	_, ok = FirstTokenBudgetForAttempt(infoFor(types.RelayFormatOpenAI, true))
	assert.False(t, ok, "a chat stream answers with its first chunk; only Responses needs this budget")
	_, ok = FirstTokenBudgetForAttempt(infoFor(types.RelayFormatOpenAIResponses, false))
	assert.False(t, ok, "a non-streaming request is not judged on its first content")
	_, ok = FirstTokenBudgetForAttempt(nil)
	assert.False(t, ok)

	operation_setting.FirstTokenTimeoutSeconds = 0
	_, ok = FirstTokenBudgetForAttempt(infoFor(types.RelayFormatOpenAIResponses, true))
	assert.False(t, ok, "0 disables the budget")
}
