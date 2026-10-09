package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zhourenke/pg-api/common"
	"github.com/zhourenke/pg-api/model"
)

type channelTagModeResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Items []model.Channel `json:"items"`
		Total int64           `json:"total"`
	} `json:"data"`
}

func channelTagModePage(t *testing.T, page int, pageSize int) channelTagModeResponse {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/channel/?tag_mode=true&p=%d&page_size=%d", page, pageSize), nil)
	GetAllChannels(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response channelTagModeResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response), recorder.Body.String())
	require.True(t, response.Success, recorder.Body.String())
	return response
}

func channelIDs(channels []model.Channel) []int {
	ids := make([]int, 0, len(channels))
	for i := range channels {
		ids = append(ids, channels[i].Id)
	}
	return ids
}

// Tag mode used to drop every channel without a tag, because both tag queries
// filtered the empty tag out: a library whose channels carry no tag at all showed
// an empty table. Those channels are now a group of their own, listed after the
// named tags and holding a slot in the page window like any other group.
func TestChannelTagModeKeepsUntaggedChannelsInTheirOwnGroup(t *testing.T) {
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))

			// Distinct priorities fix the order the channels of a group come back
			// in, which is otherwise up to the engine.
			channels := []model.Channel{
				{Id: 1, Name: "alpha-1", Type: 1, Key: "test-only", Status: common.ChannelStatusEnabled, Models: "tag-mode-test", Group: "default", Tag: common.GetPointer("alpha"), Priority: common.GetPointer(int64(50))},
				{Id: 2, Name: "alpha-2", Type: 1, Key: "test-only", Status: common.ChannelStatusEnabled, Models: "tag-mode-test", Group: "default", Tag: common.GetPointer("alpha"), Priority: common.GetPointer(int64(40))},
				{Id: 3, Name: "beta-1", Type: 1, Key: "test-only", Status: common.ChannelStatusEnabled, Models: "tag-mode-test", Group: "default", Tag: common.GetPointer("beta"), Priority: common.GetPointer(int64(30))},
				{Id: 4, Name: "untagged-empty", Type: 1, Key: "test-only", Status: common.ChannelStatusEnabled, Models: "tag-mode-test", Group: "default", Priority: common.GetPointer(int64(20))},
				{Id: 5, Name: "untagged-null", Type: 1, Key: "test-only", Status: common.ChannelStatusEnabled, Models: "tag-mode-test", Group: "default", Priority: common.GetPointer(int64(10))},
			}
			for i := range channels {
				require.NoError(t, db.Create(&channels[i]).Error)
			}
			// Rows written before the tag column existed carry NULL instead of an
			// empty string, and both mean "no tag".
			require.NoError(t, db.Exec("UPDATE channels SET tag = NULL WHERE id = ?", 5).Error)

			first := channelTagModePage(t, 1, 10)
			assert.EqualValues(t, 3, first.Data.Total, "two named tags and one untagged group")
			assert.Equal(t, []int{1, 2, 3, 4, 5}, channelIDs(first.Data.Items))
			require.NotNil(t, first.Data.Items[0].Tag)
			assert.Equal(t, "alpha", *first.Data.Items[0].Tag)

			// The untagged group is the third of three, so a two-group window ends
			// before it and the next page holds that group and nothing else.
			assert.Equal(t, []int{1, 2, 3}, channelIDs(channelTagModePage(t, 1, 2).Data.Items))
			second := channelTagModePage(t, 2, 2)
			assert.EqualValues(t, 3, second.Data.Total)
			assert.Equal(t, []int{4, 5}, channelIDs(second.Data.Items))
		})
	}
}
