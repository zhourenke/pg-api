package helper

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type deadlineRecordingConn struct {
	net.Conn

	mu        sync.Mutex
	deadlines []time.Time
}

func (c *deadlineRecordingConn) SetWriteDeadline(deadline time.Time) error {
	c.mu.Lock()
	c.deadlines = append(c.deadlines, deadline)
	c.mu.Unlock()
	return c.Conn.SetWriteDeadline(deadline)
}

// A relayed WebSocket frame used to be written with no deadline at all, so a
// peer that stopped reading blocked the relay goroutine forever.
func TestWssStringBoundsTheWriteByFrameSize(t *testing.T) {
	received := make(chan int, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_, message, err := conn.ReadMessage()
		if err != nil {
			return
		}
		received <- len(message)
	}))
	defer server.Close()

	var dialed *deadlineRecordingConn
	dialer := &websocket.Dialer{NetDial: func(network, addr string) (net.Conn, error) {
		conn, err := net.Dial(network, addr)
		if err != nil {
			return nil, err
		}
		dialed = &deadlineRecordingConn{Conn: conn}
		return dialed, nil
	}}
	conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
	require.NoError(t, err)
	defer conn.Close()

	payload := strings.Repeat("A", 16<<10)
	before := time.Now()
	require.NoError(t, WssString(nil, conn, payload))

	dialed.mu.Lock()
	deadlines := append([]time.Time(nil), dialed.deadlines...)
	dialed.mu.Unlock()
	require.NotEmpty(t, deadlines)
	// 16 KiB at the configured minimum client rate is two seconds more budget
	// than an empty frame gets.
	assert.False(t, deadlines[0].Before(before.Add(streamWriteTimeout+2*time.Second)),
		"write deadline %s does not cover the frame", deadlines[0].Sub(before))
	assert.Equal(t, len(payload), <-received)
}
