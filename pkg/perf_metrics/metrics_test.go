package perfmetrics

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/model"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/types"
)

func TestClassifyRelayOutcome(t *testing.T) {
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		name string
		ctx  context.Context
		err  *types.NewAPIError
		want Outcome
	}{
		{"success", context.Background(), nil, OutcomeSuccess},
		{"upstream bad request", context.Background(), types.InitOpenAIError("unknown", 400), OutcomeIgnored},
		{"upstream credentials returned as 400", context.Background(), types.InitOpenAIError("invalid_api_key", 400), OutcomeFailure},
		{"wrapped credentials keep their cause", context.Background(), types.NewErrorWithStatusCode(types.InitOpenAIError("invalid_api_key", 400), types.ErrorCodeInvalidRequest, 400), OutcomeFailure},
		{"upstream context limit returned as 500", context.Background(), types.InitOpenAIError("context_length_exceeded", 500), OutcomeIgnored},
		{"local rate limit", context.Background(), types.NewErrorWithStatusCode(errors.New("limited"), types.ErrorCodeInvalidRequest, 429), OutcomeIgnored},
		{"upstream rate limit", context.Background(), types.InitOpenAIError("rate_limit_exceeded", 429), OutcomeFailure},
		{"local quota", context.Background(), types.NewError(errors.New("quota"), types.ErrorCodeInsufficientUserQuota), OutcomeIgnored},
		{"local violation fee", context.Background(), types.NewError(errors.New("csam"), types.ErrorCodeViolationFeeGrokCSAM), OutcomeIgnored},
		{"upstream quota", context.Background(), types.InitOpenAIError("insufficient_quota", 429), OutcomeFailure},
		{"upstream gateway quota", context.Background(), types.InitOpenAIError(types.ErrorCodeInsufficientUserQuota, 403), OutcomeFailure},
		{"unavailable channel", context.Background(), types.NewErrorWithStatusCode(errors.New("disabled"), types.ErrorCodeGetChannelFailed, 403), OutcomeFailure},
		{"empty upstream response", context.Background(), types.NewError(errors.New("empty"), types.ErrorCodeEmptyResponse), OutcomeFailure},
		{"network failure", context.Background(), types.NewOpenAIError(errors.New("connection refused"), types.ErrorCodeDoRequestFailed, 500), OutcomeFailure},
		{"client cancellation", canceled, types.NewOpenAIError(errors.New("context canceled"), types.ErrorCodeDoRequestFailed, 500), OutcomeIgnored},
		{"upstream deadline", context.Background(), types.NewOpenAIError(context.DeadlineExceeded, types.ErrorCodeDoRequestFailed, 504), OutcomeFailure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, ClassifyRelayOutcome(tc.ctx, &relaycommon.RelayInfo{}, tc.err))
		})
	}
	assert.Equal(t, OutcomeIgnored, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{PerformanceBusinessRejection: true}, nil))
}

func TestStreamOutcomeClassification(t *testing.T) {
	for _, tc := range []struct {
		name string
		mark func(*relaycommon.StreamStatus)
		end  relaycommon.StreamEndReason
		want Outcome
	}{
		{"completed", (*relaycommon.StreamStatus).MarkCompleted, relaycommon.StreamEndReasonEOF, OutcomeSuccess},
		{"business rejection", func(s *relaycommon.StreamStatus) { s.MarkFailed("context_length_exceeded", "", 0) }, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"service error", func(s *relaycommon.StreamStatus) { s.MarkFailed("server_error", "", 0) }, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"error after completion", func(s *relaycommon.StreamStatus) { s.MarkCompleted(); s.MarkFailed("", "server_error", 0) }, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"output limit", func(s *relaycommon.StreamStatus) { s.MarkIncomplete("max_output_tokens") }, relaycommon.StreamEndReasonEOF, OutcomeSuccess},
		{"content filter", func(s *relaycommon.StreamStatus) { s.MarkIncomplete("content_filter") }, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"client cancel", (*relaycommon.StreamStatus).MarkCancelled, relaycommon.StreamEndReasonEOF, OutcomeIgnored},
		{"client gone", nil, relaycommon.StreamEndReasonClientGone, OutcomeIgnored},
		{"timeout", nil, relaycommon.StreamEndReasonTimeout, OutcomeFailure},
		{"missing terminal", nil, relaycommon.StreamEndReasonEOF, OutcomeFailure},
		{"done marker without terminal", nil, relaycommon.StreamEndReasonDone, OutcomeSuccess},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stream := relaycommon.NewStreamStatus()
			stream.RequireTerminal()
			if tc.mark != nil {
				tc.mark(stream)
			}
			stream.SetEndReason(tc.end, nil)
			assert.Equal(t, tc.want, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{StreamStatus: stream}, nil))
		})
	}
}

func TestClientCancellationDuringUpstreamRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	stream := relaycommon.NewStreamStatus()
	stream.RequireTerminal()
	stream.SetEndReason(relaycommon.StreamEndReasonScannerErr, errors.New("reader closed"))
	assert.Equal(t, OutcomeIgnored, ClassifyRelayOutcome(ctx, &relaycommon.RelayInfo{StreamStatus: stream}, nil))

	deadline := relaycommon.NewStreamStatus()
	deadline.SetEndReason(relaycommon.StreamEndReasonClientGone, context.DeadlineExceeded)
	assert.Equal(t, OutcomeFailure, ClassifyRelayOutcome(context.Background(), &relaycommon.RelayInfo{StreamStatus: deadline}, nil))
}

func TestPerformanceWindowIncludesCurrentHour(t *testing.T) {
	now := time.Date(2026, 9, 14, 12, 37, 0, 0, time.UTC)
	start, end := queryWindow(now, 24)
	assert.Equal(t, time.Date(2026, 9, 13, 13, 0, 0, 0, time.UTC).Unix(), start)
	assert.Equal(t, now.Unix(), end)
}

func TestHourlySuccessSeriesWeightsSmallerBuckets(t *testing.T) {
	points := recentSuccessSeries(map[int64]counters{
		3600: {requestCount: 100, successCount: 100},
		3900: {requestCount: 1},
		7200: {requestCount: 1, successCount: 1},
	})
	assert.Equal(t, []SuccessRatePoint{{Ts: 3600, SuccessRate: 99.01}, {Ts: 7200, SuccessRate: 100}}, points)
}

func TestRecentHourWindowUsesTheNewestHoursWithTraffic(t *testing.T) {
	// The pricing card must not read the 24h average. Only the two newest hours
	// with traffic count: hour 3600 is older and is dropped even though it holds
	// the most samples, and hour 14400 has no traffic at all. The 3900 bucket is
	// sub-hourly and must be merged into hour 3600 before the window is chosen.
	ttftMs, tps, hours := recentHourWindow(map[int64]counters{
		3600:  {requestCount: 3, ttftSumMs: 3000, ttftCount: 3, outputTokens: 30, generationMs: 3000},
		3900:  {requestCount: 1, ttftSumMs: 9000, ttftCount: 1, outputTokens: 10, generationMs: 1000},
		7200:  {requestCount: 2, ttftSumMs: 2000, ttftCount: 2, outputTokens: 40, generationMs: 4000},
		10800: {requestCount: 1, ttftSumMs: 1000, ttftCount: 1, outputTokens: 21, generationMs: 2000},
		14400: {},
	})
	assert.Equal(t, int64(1000), ttftMs)
	assert.Equal(t, 10.17, tps)
	assert.Equal(t, 2, hours)

	// A single hour with traffic is still better than nothing.
	ttftMs, tps, hours = recentHourWindow(map[int64]counters{
		3600: {requestCount: 4, ttftSumMs: 2000, ttftCount: 4},
	})
	assert.Equal(t, int64(500), ttftMs)
	assert.Equal(t, 0.0, tps)
	assert.Equal(t, 1, hours)

	// No usable sample in the window at all.
	ttftMs, tps, hours = recentHourWindow(map[int64]counters{3600: {}})
	assert.Equal(t, int64(0), ttftMs)
	assert.Equal(t, 0.0, tps)
	assert.Equal(t, 0, hours)
}

// TEST_PERF_MYSQL_DSN / TEST_PERF_POSTGRES_DSN optionally run the aggregation
// against isolated real MySQL/PostgreSQL databases.
func TestPerformanceAggregationAndFlush(t *testing.T) {
	for _, dialect := range []struct{ name, env string }{
		{"sqlite", ""}, {"mysql", "TEST_PERF_MYSQL_DSN"}, {"postgres", "TEST_PERF_POSTGRES_DSN"},
	} {
		t.Run(dialect.name, func(t *testing.T) {
			dsn := ""
			if dialect.env != "" {
				dsn = os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip("isolated test database DSN is not configured")
				}
			}
			t.Setenv("SQL_DSN", dsn)
			oldDB, oldPath, oldMaster, oldRedis := model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled
			oldType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			common.SQLitePath, common.IsMasterNode, common.RedisEnabled = filepath.Join(t.TempDir(), "perf.db"), false, false
			hotBuckets.Clear()
			t.Cleanup(func() {
				model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled = oldDB, oldPath, oldMaster, oldRedis
				common.SetDatabaseTypes(oldType, oldLogType)
				hotBuckets.Clear()
			})
			require.NoError(t, model.InitDB())
			db := model.DB
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.Migrator().DropTable(&model.PerfMetric{}))
			require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))

			now := time.Now()
			start, _ := queryWindow(now, 24)
			hour := now.Unix() - now.Unix()%3600 - 3600
			// Historical counters remain usable without reclassification or migration.
			for _, row := range []model.PerfMetric{
				{ModelName: "test-model", Group: "a", BucketTs: hour, RequestCount: 100, SuccessCount: 100, TotalLatencyMs: 100000, TtftCount: 100, TtftSumMs: 10000, OutputTokens: 200, GenerationMs: 40000},
				{ModelName: "test-model", Group: "inactive", BucketTs: hour, RequestCount: 100},
				{ModelName: "test-model", Group: "a", BucketTs: start - 3600, RequestCount: 100},
			} {
				require.NoError(t, model.UpsertPerfMetric(&row))
			}
			groups := []string{"a", "b"}

			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "test-model", UsingGroup: "b", StartTime: now}, types.InitOpenAIError("unknown", 400))
			businessRejected, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			require.NotNil(t, businessRejected.Summary)
			assert.Equal(t, 100.0, businessRejected.Summary.SuccessRate)

			failure := &atomicBucket{}
			failure.add(Sample{LatencyMs: 2000})
			hotBuckets.Store(bucketKey{model: "test-model", group: "b", bucketTs: hour}, failure)
			before, err := Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			require.NotNil(t, before.Summary)
			assert.Equal(t, Summary{SuccessRate: 99.01, AvgLatencyMs: 1009, AvgTps: 5}, *before.Summary)
			assert.Equal(t, start, before.WindowStart)
			require.Len(t, before.Series, 1)
			assert.Equal(t, hour, before.Series[0].Ts)
			assert.InDelta(t, 99.01, before.Series[0].SuccessRate, 0.01)
			require.Len(t, before.Groups, 2)

			summary, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			assert.Equal(t, before.Summary, summary.Summary)
			require.Len(t, summary.Models, 1)
			assert.Equal(t, 99.01, summary.Models[0].SuccessRate)
			// The pricing card reads the first-token latency; the failing sample
			// above reported none, so only the stored TTFT samples count.
			assert.Equal(t, int64(100), summary.Models[0].AvgTtftMs)
			assert.Equal(t, 99.01, summary.Models[0].RecentSuccessSeries[0].SuccessRate)
			encoded, err := common.Marshal(summary)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "request_count")
			assert.NotContains(t, string(encoded), "success_count")

			flushHotBuckets()
			flushHotBuckets()
			after, err := Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, before.Summary, after.Summary)
			assert.Equal(t, before.Series, after.Series)

			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "test-model", UsingGroup: "a", StartTime: now}, types.InitOpenAIError("context_length_exceeded", 400))
			after, err = Query(QueryParams{Model: "test-model", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, before.Summary, after.Summary)
			onlyA, err := Query(QueryParams{Model: "test-model", Group: "a", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Equal(t, 100.0, onlyA.Summary.SuccessRate)
			empty, err := Query(QueryParams{Model: "missing", Hours: 24, AllowedGroups: groups})
			require.NoError(t, err)
			assert.Nil(t, empty.Summary)
			assert.Empty(t, empty.Series)

			require.NoError(t, model.UpsertPerfMetric(&model.PerfMetric{ModelName: "second-model", Group: "a", BucketTs: hour, RequestCount: 1}))
			combined, err := QuerySummaryAll(24, groups)
			require.NoError(t, err)
			assert.Equal(t, 98.04, combined.Summary.SuccessRate)
			assert.Equal(t, 99.01, combined.Models[0].SuccessRate)

			// The periodic flush drains the current partial hour as well, so the row
			// is stored instead of living only in memory. FlushNow is the shutdown
			// path and must persist it without waiting for the flush interval.
			currentHour := now.Unix() - now.Unix()%3600
			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "flush-model", UsingGroup: "b", StartTime: now}, nil)
			FlushNow()
			stored, err := model.GetPerfMetrics("flush-model", "b", currentHour, currentHour)
			require.NoError(t, err)
			require.Len(t, stored, 1)
			assert.Equal(t, int64(1), stored[0].RequestCount)

			RecordRelayResult(context.Background(), &relaycommon.RelayInfo{OriginModelName: "flush-model", UsingGroup: "b", StartTime: now}, nil)
			flushHotBuckets()
			stored, err = model.GetPerfMetrics("flush-model", "b", currentHour, currentHour)
			require.NoError(t, err)
			require.Len(t, stored, 1)
			assert.Equal(t, int64(2), stored[0].RequestCount, "partial flushes upsert onto the same current-hour row")

			// The sample must end where settlement recorded the end of the
			// response, not where sampling happens to run: on a device whose
			// database commits take hundreds of milliseconds, sampling the wall
			// clock here charged that settlement to the model and made the card
			// disagree with the same request's usage-log row.
			settledAt := time.Now().Add(-1500 * time.Millisecond)
			endInfo := &relaycommon.RelayInfo{
				OriginModelName:         "end-model",
				UsingGroup:              "b",
				StartTime:               settledAt.Add(-5 * time.Second),
				FirstResponseTime:       settledAt.Add(-3 * time.Second),
				IsStream:                true,
				ResponseEndTime:         settledAt,
				PerformanceOutputTokens: 100,
			}
			RecordRelayResult(context.Background(), endInfo, nil)
			value, ok := hotBuckets.Load(bucketKey{
				model:    "end-model",
				group:    "b",
				bucketTs: bucketStart(settledAt.Unix()),
			})
			require.True(t, ok, "the sample must land in the recorded instant's bucket")
			endCounters := value.(*atomicBucket).snapshot()
			assert.Equal(t, int64(5000), endCounters.totalLatencyMs)
			assert.Equal(t, int64(2000), endCounters.ttftSumMs)
			assert.Equal(t, int64(1), endCounters.ttftCount)
			assert.Equal(t, int64(100), endCounters.outputTokens)
			assert.Equal(t, int64(3000), endCounters.generationMs)

			// A burst delivery (< 250ms or > 350 t/s) preserves request count,
			// latency and TTFT, but excludes tokens and generation time from the throughput pool.
			burstInfo := &relaycommon.RelayInfo{
				OriginModelName:         "burst-model",
				UsingGroup:              "b",
				StartTime:               settledAt.Add(-1000 * time.Millisecond),
				FirstResponseTime:       settledAt.Add(-50 * time.Millisecond),
				IsStream:                true,
				ResponseEndTime:         settledAt,
				PerformanceOutputTokens: 200,
			}
			RecordRelayResult(context.Background(), burstInfo, nil)
			bValue, bOk := hotBuckets.Load(bucketKey{
				model:    "burst-model",
				group:    "b",
				bucketTs: bucketStart(settledAt.Unix()),
			})
			require.True(t, bOk)
			burstCounters := bValue.(*atomicBucket).snapshot()
			assert.Equal(t, int64(1), burstCounters.requestCount)
			assert.Equal(t, int64(1), burstCounters.successCount)
			assert.Equal(t, int64(1000), burstCounters.totalLatencyMs)
			assert.Equal(t, int64(950), burstCounters.ttftSumMs)
			assert.Equal(t, int64(1), burstCounters.ttftCount)
			assert.Equal(t, int64(0), burstCounters.outputTokens, "burst delivery tokens must not be pooled")
			assert.Equal(t, int64(0), burstCounters.generationMs, "burst delivery duration must not be pooled")
		})
	}
}

// The manual history cleanup deletes the derived statistics of the same range
// with the same cutoff as the usage logs. Run those deletes on every supported
// engine: the failure that matters is a dialect where the delete matches
// nothing and the cleanup silently keeps the rows.
func TestDerivedStatisticDeletionMatrix(t *testing.T) {
	for _, dialect := range []struct{ name, env string }{
		{"sqlite", ""}, {"mysql", "TEST_PERF_MYSQL_DSN"}, {"postgres", "TEST_PERF_POSTGRES_DSN"},
	} {
		t.Run(dialect.name, func(t *testing.T) {
			dsn := ""
			if dialect.env != "" {
				dsn = os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip("isolated test database DSN is not configured")
				}
			}
			t.Setenv("SQL_DSN", dsn)
			oldDB, oldPath, oldMaster, oldRedis := model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled
			oldType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			common.SQLitePath, common.IsMasterNode, common.RedisEnabled = filepath.Join(t.TempDir(), "cleanup.db"), false, false
			t.Cleanup(func() {
				model.DB, common.SQLitePath, common.IsMasterNode, common.RedisEnabled = oldDB, oldPath, oldMaster, oldRedis
				common.SetDatabaseTypes(oldType, oldLogType)
			})
			require.NoError(t, model.InitDB())
			db := model.DB
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.Migrator().DropTable(&model.QuotaData{}, &model.PerfMetric{}))
			require.NoError(t, db.AutoMigrate(&model.QuotaData{}, &model.PerfMetric{}))

			now := time.Now()
			cutoff := now.Unix() - 3600
			oldBucket := now.Unix() - now.Unix()%3600 - 3600
			currentBucket := now.Unix() - now.Unix()%3600
			require.NoError(t, db.Create(&[]model.QuotaData{
				{UserID: 1, Username: "before", ModelName: "m", CreatedAt: cutoff - 1, Quota: 1},
				{UserID: 1, Username: "at", ModelName: "m", CreatedAt: cutoff, Quota: 1},
				{UserID: 1, Username: "after", ModelName: "m", CreatedAt: cutoff + 60, Quota: 1},
			}).Error)
			require.NoError(t, db.Create(&[]model.PerfMetric{
				{ModelName: "m", Group: "g", BucketTs: oldBucket, RequestCount: 1},
				{ModelName: "m", Group: "g", BucketTs: currentBucket, RequestCount: 1},
			}).Error)

			deletedQuota, err := model.DeleteQuotaDataBefore(cutoff)
			require.NoError(t, err)
			assert.Equal(t, int64(1), deletedQuota, "rows at the cutoff survive")
			deletedMetrics, err := model.DeletePerfMetricsBefore(cutoff)
			require.NoError(t, err)
			assert.Equal(t, int64(1), deletedMetrics, "only whole-hour buckets before the cutoff go")

			var quotaLeft, metricLeft int64
			require.NoError(t, db.Model(&model.QuotaData{}).Count(&quotaLeft).Error)
			assert.Equal(t, int64(2), quotaLeft)
			require.NoError(t, db.Model(&model.PerfMetric{}).Count(&metricLeft).Error)
			assert.Equal(t, int64(1), metricLeft)

			// A second cleanup over the same range is a no-op, not an error.
			deletedQuota, err = model.DeleteQuotaDataBefore(cutoff)
			require.NoError(t, err)
			assert.Equal(t, int64(0), deletedQuota)
			deletedMetrics, err = model.DeletePerfMetricsBefore(cutoff)
			require.NoError(t, err)
			assert.Equal(t, int64(0), deletedMetrics)
		})
	}
}
