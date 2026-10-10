package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/model"
)

// A request format that a channel type cannot convert used to be routed at
// random among the channels of the model and then failed with a 500 from that
// channel's conversion stub. Channel selection now prefers a channel that can
// convert the requested format, and must never turn that preference into
// "no available channel" when no channel can.
func TestDistributePrefersChannelThatConvertsTheRequestFormat(t *testing.T) {
	// Mistral converts none of the seven formats; Anthropic converts Claude.
	const unableChannelId = 1
	const ableChannelId = 2

	seedChannels := func(t *testing.T, withUnable bool, withAble bool) {
		db := setupDistributorPlaygroundTest(t)
		baseURL := "http://127.0.0.1:1"
		priority := int64(0)
		if withUnable {
			// The unable channel deliberately outranks the able one, so selection
			// only reaches the able channel when the preference applies.
			higherPriority := int64(10)
			require.NoError(t, db.Create(&model.Channel{
				Id: unableChannelId, Type: constant.ChannelTypeMistral, Key: "sk-test",
				Status: common.ChannelStatusEnabled, Name: "unable", Group: "default",
				Models: "route-model", Priority: &higherPriority, BaseURL: &baseURL,
			}).Error)
			require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "route-model", ChannelId: unableChannelId, Enabled: true}).Error)
		}
		if withAble {
			require.NoError(t, db.Create(&model.Channel{
				Id: ableChannelId, Type: constant.ChannelTypeAnthropic, Key: "sk-test",
				Status: common.ChannelStatusEnabled, Name: "able", Group: "default",
				Models: "route-model", Priority: &priority, BaseURL: &baseURL,
			}).Error)
			require.NoError(t, db.Create(&model.Ability{Group: "default", Model: "route-model", ChannelId: ableChannelId, Enabled: true}).Error)
		}
		require.NoError(t, model.InitChannelCache())
	}

	distribute := func(t *testing.T, path string) (*httptest.ResponseRecorder, int) {
		t.Helper()
		gin.SetMode(gin.TestMode)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, path, strings.NewReader(
			`{"model":"route-model","group":"default","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}`))
		c.Request.Header.Set("Content-Type", "application/json")
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")

		Distribute()(c)

		return recorder, common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	}

	t.Run("a Claude request skips a higher-priority channel that cannot convert it", func(t *testing.T) {
		seedChannels(t, true, true)

		recorder, selected := distribute(t, "/v1/messages")

		require.NotEqual(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
		assert.Equal(t, ableChannelId, selected)
	})

	t.Run("a Claude request with no able channel still reaches the unable one", func(t *testing.T) {
		seedChannels(t, true, false)

		recorder, selected := distribute(t, "/v1/messages")

		// The preference is dropped rather than reported as "no available
		// channel": the request reaches the channel and gets the explicit
		// refusal from its adaptor, which is a 400 rather than a 503.
		require.NotEqual(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
		assert.Equal(t, unableChannelId, selected)
	})

	t.Run("a chat request keeps ordinary priority order", func(t *testing.T) {
		seedChannels(t, true, true)

		recorder, selected := distribute(t, "/v1/chat/completions")

		// Chat completions convert the universal OpenAI shape, so no format is
		// required and the higher-priority channel stays first.
		require.NotEqual(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
		assert.Equal(t, unableChannelId, selected)
	})
}
