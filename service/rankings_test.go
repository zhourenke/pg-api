package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/model"
)

// Mid-January keeps every timezone free of a daylight-saving transition inside
// the windows below, so the bucket counts are the same on any machine.
var rankingTestNow = time.Date(2026, 1, 15, 8, 20, 0, 0, time.UTC)

func TestRankingTimelineSpansEveryBucketOfTheRange(t *testing.T) {
	tests := []struct {
		period string
		// One row per distinct bucket label of the range: 24 hourly columns for
		// the 24-hour window (its 25th boundary repeats the first local hour),
		// 8 daily columns for the week, 31 for the month, and 54 weekly ones
		// for the year.
		want int
	}{
		{period: "today", want: 24},
		{period: "week", want: 8},
		{period: "month", want: 31},
		{period: "year", want: 54},
	}

	for _, test := range tests {
		t.Run(test.period, func(t *testing.T) {
			config, err := rankingConfig(test.period)
			require.NoError(t, err)
			startTime, endTime := rankingTimeRange(config, rankingTestNow)

			timeline := rankingTimeline(startTime, endTime, config)
			require.Len(t, timeline, test.want)

			seen := make(map[string]struct{}, len(timeline))
			for index, bucket := range timeline {
				ts, err := time.Parse(time.RFC3339, bucket.Ts)
				require.NoError(t, err)
				assert.Zero(t, ts.Unix()%config.bucketSize, "bucket %d is not aligned", index)
				assert.NotEmpty(t, bucket.Label)
				// A repeated label would collapse two columns into one in the
				// band scale, so the timeline must not carry one.
				_, duplicate := seen[bucket.Label]
				assert.False(t, duplicate, "bucket %d repeats the label %q", index, bucket.Label)
				seen[bucket.Label] = struct{}{}
				if index == 0 {
					assert.Equal(t, startTime/config.bucketSize*config.bucketSize, ts.Unix())
					continue
				}
				previous, err := time.Parse(time.RFC3339, timeline[index-1].Ts)
				require.NoError(t, err)
				assert.Equal(t, config.bucketSize, ts.Unix()-previous.Unix(), "bucket %d is not contiguous", index)
			}
		})
	}
}

func TestHistorySeriesPublishTheTimeline(t *testing.T) {
	config, err := rankingConfig("today")
	require.NoError(t, err)
	startTime, endTime := rankingTimeRange(config, rankingTestNow)
	timeline := rankingTimeline(startTime, endTime, config)
	bucket := startTime / config.bucketSize * config.bucketSize

	totals := []model.RankingQuotaTotal{{ModelName: "gpt-4o", TotalTokens: 1200}}
	buckets := []model.RankingQuotaBucket{{ModelName: "gpt-4o", Bucket: bucket, Tokens: 1200}}
	meta := map[string]rankingModelMeta{"gpt-4o": {vendor: "OpenAI"}}

	models := buildModelHistory(buckets, totals, meta, config, timeline)
	assert.Equal(t, timeline, models.Timeline)
	assert.Equal(t, len(timeline), models.Buckets)
	// The points stay sparse: buckets without traffic keep their column but
	// carry no datum.
	assert.Len(t, models.Points, 1)
	assert.Equal(t, timeline[0].Label, models.Points[0].Label)

	vendors := buildVendorShareHistory(buckets, []RankedVendor{{Vendor: "OpenAI", TotalTokens: 1200}}, 1200, meta, config, timeline)
	assert.Equal(t, timeline, vendors.Timeline)
	assert.Equal(t, len(timeline), vendors.Buckets)
	assert.Len(t, vendors.Points, 1)
	assert.Equal(t, timeline[0].Label, vendors.Points[0].Label)
}
