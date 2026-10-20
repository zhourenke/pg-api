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
