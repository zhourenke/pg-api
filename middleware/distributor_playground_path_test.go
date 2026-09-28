package middleware

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/constant"
	"github.com/zhourenke/pg-api/model"
	"github.com/zhourenke/pg-api/relaykit/dto"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The playground posts the public chat-completions shape to /pg/chat/completions,
// while an advanced-custom channel declares its routes with the public /v1 paths.
// Channel selection must therefore judge the playground request by its public
// path, otherwise no advanced-custom channel can ever serve the playground.
func TestDistributePlaygroundUsesPublicRequestPath(t *testing.T) {
	tests := []struct {
		name        string
		requestPath string
		routes      []string
		wantChannel bool
	}{
		{
			name:        "playground matches the declared chat route",
			requestPath: "/pg/chat/completions",
			routes:      []string{"/v1/chat/completions"},
			wantChannel: true,
		},
		{
			name:        "public chat path keeps matching",
			requestPath: "/v1/chat/completions",
			routes:      []string{"/v1/chat/completions"},
			wantChannel: true,
		},
		{
			name:        "playground still enforces the declared routes",
			requestPath: "/pg/chat/completions",
			routes:      []string{"/v1/responses"},
			wantChannel: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupDistributorPlaygroundTest(t)
			routes := make([]dto.AdvancedCustomRoute, 0, len(tt.routes))
			for _, path := range tt.routes {
				routes = append(routes, dto.AdvancedCustomRoute{
					IncomingPath: path,
					UpstreamPath: path,
					Converter:    "none",
				})
			}
			settings, err := common.Marshal(dto.ChannelOtherSettings{
				AdvancedCustom: &dto.AdvancedCustomConfig{Routes: routes},
			})
			require.NoError(t, err)
			channel := &model.Channel{
				Id:            1,
				Type:          constant.ChannelTypeAdvancedCustom,
				Key:           "test-key",
				Status:        common.ChannelStatusEnabled,
				Name:          "advanced",
				Group:         "default",
				Models:        "route-model",
				OtherSettings: string(settings),
			}
			require.NoError(t, db.Create(channel).Error)
			require.NoError(t, db.Create(&model.Ability{
				Group: "default", Model: "route-model", ChannelId: channel.Id, Enabled: true,
			}).Error)
			require.NoError(t, model.InitChannelCache())

			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, tt.requestPath, strings.NewReader(
				`{"model":"route-model","group":"default","messages":[{"role":"user","content":"hi"}]}`))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(c, constant.ContextKeyUserGroup, "default")

			Distribute()(c)

			if !tt.wantChannel {
				assert.Equal(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
				return
			}
			require.NotEqual(t, http.StatusServiceUnavailable, recorder.Code, recorder.Body.String())
			assert.Equal(t, channel.Id, common.GetContextKeyInt(c, constant.ContextKeyChannelId))
		})
	}
}

func setupDistributorPlaygroundTest(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := model.DB
	previousMemoryCache := common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "playground.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	model.DB = db
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		model.DB = previousDB
		common.MemoryCacheEnabled = previousMemoryCache
		_ = sqlDB.Close()
	})
	return db
}
