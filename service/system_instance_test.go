package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/model"
)

// The stale-instance endpoints delete rows by last_seen_at, so a node that
// misses one heartbeat must still read as online: the stale window has to stay
// wider than the reporting interval. See DEVELOPMENT.md §6.18.
func TestSystemInstanceStaleWindowSurvivesAMissedHeartbeat(t *testing.T) {
	reportInterval := int64(systemInstanceReportInterval / time.Second)
	require.GreaterOrEqual(t, model.SystemInstanceStaleAfterSeconds, 2*reportInterval,
		"one missed heartbeat would mark the reporting node stale and deletable")
}
