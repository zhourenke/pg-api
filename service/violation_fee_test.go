/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/model"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/setting/model_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The violation fee writes its own consume log outside the relay settlement
// paths, so it must carry the same millisecond duration the usage log derives
// generation throughput from.
func TestChargeViolationFeeRecordsMillisecondUseTime(t *testing.T) {
	gin.SetMode(gin.TestMode)
	truncate(t)
	seedUser(t, 1, 1_000_000)
	token := &model.Token{UserId: 1, Key: "violation-fee-test", Name: "violation-fee", RemainQuota: 1_000_000, Status: common.TokenStatusEnabled}
	require.NoError(t, model.DB.Create(token).Error)

	settings := model_setting.GetGrokSettings()
	previousEnabled, previousAmount := settings.ViolationDeductionEnabled, settings.ViolationDeductionAmount
	settings.ViolationDeductionEnabled = true
	settings.ViolationDeductionAmount = 0.05
	t.Cleanup(func() {
		settings.ViolationDeductionEnabled = previousEnabled
		settings.ViolationDeductionAmount = previousAmount
	})

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		UserId:          1,
		TokenId:         token.Id,
		TokenKey:        token.Key,
		OriginModelName: "grok-4",
		UsingGroup:      "default",
		UserQuota:       1_000_000,
		StartTime:       time.Now().Add(-1500 * time.Millisecond),
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: 1},
	}
	info.PriceData.GroupRatioInfo.GroupRatio = 1

	apiErr := types.NewError(errors.New("csam"), types.ErrorCodeViolationFeeGrokCSAM)
	require.True(t, ChargeViolationFeeIfNeeded(ctx, info, apiErr))

	var log model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ?", 1).Take(&log).Error)
	assert.GreaterOrEqual(t, log.UseTime, 1500, "use_time stores exact milliseconds")
	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
	useTimeMs, ok := other["use_time_ms"].(float64)
	require.True(t, ok, "the violation fee log must carry the millisecond duration")
	assert.GreaterOrEqual(t, useTimeMs, float64(1500))
	assert.Less(t, useTimeMs, float64(60_000))
}
