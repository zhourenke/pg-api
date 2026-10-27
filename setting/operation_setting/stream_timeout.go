package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
)

// A streaming attempt that has not produced any content yet is bounded by two
// budgets, because the two waits have different causes and different owners:
//
//   - the first-token budget counts from the moment the client's request
//     started, so it also covers waiting for the upstream response headers and
//     any slow prefill before the stream says anything;
//   - the first-content budget counts from the moment the upstream stream
//     opened, so it catches a stream that answered `response.created` and then
//     went silent without ever producing content.
//
// Exceeding either one aborts the attempt while nothing has been written to the
// client yet, which keeps failover to another channel legal. Zero disables the
// corresponding budget, and both are disabled by default so that a model that
// legitimately thinks for a while is never abandoned unless an operator asks
// for the bound.
const (
	DefaultFirstTokenTimeoutSeconds   = 0
	DefaultFirstContentTimeoutSeconds = 0
	// maxStreamTimeoutSeconds keeps a rounded or mistyped value from turning the
	// budgets into a de facto unlimited wait; STREAMING_TIMEOUT still bounds a
	// stream that keeps emitting data.
	maxStreamTimeoutSeconds = 3600
)

var (
	FirstTokenTimeoutSeconds   = DefaultFirstTokenTimeoutSeconds
	FirstContentTimeoutSeconds = DefaultFirstContentTimeoutSeconds
)

func FirstTokenTimeoutSecondsFromString(value string) error {
	seconds, err := ParseStreamTimeoutSeconds(value)
	if err != nil {
		return err
	}
	FirstTokenTimeoutSeconds = seconds
	return nil
}

func FirstContentTimeoutSecondsFromString(value string) error {
	seconds, err := ParseStreamTimeoutSeconds(value)
	if err != nil {
		return err
	}
	FirstContentTimeoutSeconds = seconds
	return nil
}

// ParseStreamTimeoutSeconds validates one budget as a whole number of seconds.
func ParseStreamTimeoutSeconds(value string) (int, error) {
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("stream timeout must be a whole number of seconds")
	}
	if seconds < 0 || seconds > maxStreamTimeoutSeconds {
		return 0, fmt.Errorf("stream timeout must be between 0 and %d seconds", maxStreamTimeoutSeconds)
	}
	return seconds, nil
}
