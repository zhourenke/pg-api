package model

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// newChannelCacheTestDB opens a private database for cache tests so they can
// break a table without disturbing the shared in-memory database.
func newChannelCacheTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), name)), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

// useChannelCacheTestDB points the shared handle at a private database with the
// memory cache enabled, restoring both afterwards.
func useChannelCacheTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	previousDB := DB
	previousMemoryCache := common.MemoryCacheEnabled
	DB = db
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		DB = previousDB
		common.MemoryCacheEnabled = previousMemoryCache
	})
}

func seedChannelCacheTestData(t *testing.T, db *gorm.DB) *Channel {
	t.Helper()
	channel := &Channel{
		Id:     1,
		Name:   "cache",
		Key:    "key",
		Status: common.ChannelStatusEnabled,
		Group:  "default",
		Models: "m1",
	}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&Ability{Group: "default", Model: "m1", ChannelId: channel.Id, Enabled: true}).Error)
	require.NoError(t, InitChannelCache())

	selected, err := GetRandomSatisfiedChannel("default", "m1", 0, nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	return channel
}

// A failed load used to publish the empty routing table built from it, which
// took every model offline until the next sync. It must keep the previous one.
func TestInitChannelCacheKeepsPreviousRoutingWhenChannelLoadFails(t *testing.T) {
	db := newChannelCacheTestDB(t, "cache.db")
	useChannelCacheTestDB(t, db)
	seedChannelCacheTestData(t, db)

	require.NoError(t, db.Migrator().DropTable("channels"))
	require.Error(t, InitChannelCache())

	selected, err := GetRandomSatisfiedChannel("default", "m1", 0, nil)
	require.NoError(t, err)
	require.NotNil(t, selected, "a failed channel load must keep the published routing table")
}

func TestInitChannelCacheKeepsPreviousRoutingWhenAbilityLoadFails(t *testing.T) {
	db := newChannelCacheTestDB(t, "cache.db")
	useChannelCacheTestDB(t, db)
	seedChannelCacheTestData(t, db)

	require.NoError(t, db.Migrator().DropTable("abilities"))
	require.Error(t, InitChannelCache())

	selected, err := GetRandomSatisfiedChannel("default", "m1", 0, nil)
	require.NoError(t, err)
	require.NotNil(t, selected, "a failed ability load must keep the published routing table")
}

func TestInitChannelCachePublishesSuccessfulLoad(t *testing.T) {
	db := newChannelCacheTestDB(t, "cache.db")
	useChannelCacheTestDB(t, db)
	channel := seedChannelCacheTestData(t, db)

	require.NoError(t, db.Model(&Channel{}).Where("id = ?", channel.Id).
		Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, InitChannelCache())

	selected, err := GetRandomSatisfiedChannel("default", "m1", 0, nil)
	require.NoError(t, err)
	assert.Nil(t, selected, "a successful load must still replace the published routing table")
}

func TestGetRandomSatisfiedChannelExcludesAttemptedChannelsOnRetry(t *testing.T) {
	db := newChannelCacheTestDB(t, "exclude_cache.db")
	useChannelCacheTestDB(t, db)

	ch1 := &Channel{Id: 101, Name: "ch1", Key: "k1", Status: common.ChannelStatusEnabled, Group: "default", Models: "m-equal", Weight: common.GetPointer(uint(10)), Priority: common.GetPointer(int64(0))}
	ch2 := &Channel{Id: 102, Name: "ch2", Key: "k2", Status: common.ChannelStatusEnabled, Group: "default", Models: "m-equal", Weight: common.GetPointer(uint(10)), Priority: common.GetPointer(int64(0))}
	require.NoError(t, db.Create(ch1).Error)
	require.NoError(t, db.Create(ch2).Error)
	require.NoError(t, db.Create(&Ability{Group: "default", Model: "m-equal", ChannelId: ch1.Id, Enabled: true, Weight: 10, Priority: common.GetPointer(int64(0))}).Error)
	require.NoError(t, db.Create(&Ability{Group: "default", Model: "m-equal", ChannelId: ch2.Id, Enabled: true, Weight: 10, Priority: common.GetPointer(int64(0))}).Error)
	require.NoError(t, InitChannelCache())

	for _, mem := range []bool{true, false} {
		t.Run(map[bool]string{true: "memory", false: "database"}[mem], func(t *testing.T) {
			common.MemoryCacheEnabled = mem
			// When channel 101 failed and is excluded, channel 102 must always be selected across multiple runs
			for range 20 {
				selected, err := GetRandomSatisfiedChannel("default", "m-equal", 1, nil, 101)
				require.NoError(t, err)
				require.NotNil(t, selected)
				assert.Equal(t, 102, selected.Id, "retry must exclude the attempted channel 101 and pick channel 102")
			}
			// When both are excluded, returns nil so retry moves to next group or stops cleanly
			exhausted, err := GetRandomSatisfiedChannel("default", "m-equal", 2, nil, 101, 102)
			require.NoError(t, err)
			assert.Nil(t, exhausted, "when all candidates at this priority have failed, returns nil")
		})
	}
}
