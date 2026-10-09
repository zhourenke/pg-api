package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/i18n"
	relaycommon "github.com/zhourenke/pg-api/relay/common"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"github.com/zhourenke/pg-api/relaykit/types"
	"github.com/zhourenke/pg-api/setting/config"
	"github.com/zhourenke/pg-api/setting/operation_setting"
	"github.com/zhourenke/pg-api/setting/ratio_setting"
)

// PrepareRequestBilling is the single pre-request billing entry point, so the
// unpriced-tool gate has to live there: a request declaring a built-in billable
// tool nobody priced is refused before any quota is reserved.
func TestPrepareRequestBillingRejectsUnpricedDeclaredTool(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require.NoError(t, i18n.Init())
	setupRelayChannelDB(t)

	savedRatios := ratio_setting.ModelRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(savedRatios))
	})
	ratios := ratio_setting.GetModelRatioCopy()
	ratios["tool-gate-model"] = 1
	ratioJSON, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(ratioJSON)))

	previousToolPrices := config.GlobalConfig.ExportAllConfigs()["tool_price_setting.prices"]
	operation_setting.LoadToolPricesFromJSONString(`{}`)
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
			"tool_price_setting.prices": previousToolPrices,
		}))
	})

	oldSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = false
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = oldSelfUse })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	ctx.Set("group", "default")

	maxTokens := uint(16)
	info := &relaycommon.RelayInfo{
		RelayFormat:     types.RelayFormatClaude,
		OriginModelName: "tool-gate-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		Request: &dto.ClaudeRequest{
			Model:     "tool-gate-model",
			MaxTokens: &maxTokens,
			Tools: []any{
				map[string]any{"type": "web_search_20250305", "name": "web_search"},
			},
		},
	}

	apiErr := PrepareRequestBilling(ctx, info)

	require.NotNil(t, apiErr)
	assert.Equal(t, types.ErrorCodeToolPriceNotConfigured, apiErr.GetErrorCode())
	assert.Contains(t, apiErr.Error(), dto.BuildInToolWebSearch)
	assert.Nil(t, info.Billing, "a refused tool must not reserve quota")
}
