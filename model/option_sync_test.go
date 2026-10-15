package model

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zhourenke/pg-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 保护契约:周期性选项同步必须在取选项锁之前读库。它读的是一次可能排在数据库写
// 提交后面的慢查询,持锁等它会把选项写入与 passkey 的登录/注册一起挡住。
func TestLoadOptionsFromDatabaseReadsBeforeTakingOptionLocks(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "options.db")), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&Option{}))
	require.NoError(t, db.Create(&Option{Key: "Notice", Value: "from-db"}).Error)

	previousDB := DB
	DB = db
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})

	// Hold the sync inside its read so the assertions below run while the read
	// is still in flight. Only the first query is held.
	readStarted := make(chan struct{})
	releaseRead := make(chan struct{})
	held := make(chan struct{}, 1)
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("hold_option_read", func(*gorm.DB) {
		select {
		case held <- struct{}{}:
			close(readStarted)
			<-releaseRead
		default:
		}
	}))
	t.Cleanup(func() { require.NoError(t, db.Callback().Query().Remove("hold_option_read")) })

	synced := make(chan struct{})
	go func() {
		defer close(synced)
		loadOptionsFromDatabase()
	}()

	select {
	case <-readStarted:
	case <-time.After(10 * time.Second):
		close(releaseRead)
		t.Fatal("the sync never started reading the option table")
	}

	writeLocksFree := make(chan struct{})
	go func() {
		defer close(writeLocksFree)
		requestPolicyOptionMutex.Lock()
		requestPolicyOptionMutex.Unlock()
		passkeyOptionMutex.Lock()
		passkeyOptionMutex.Unlock()
	}()
	select {
	case <-writeLocksFree:
	case <-time.After(10 * time.Second):
		close(releaseRead)
		t.Fatal("an option write would wait for the sync's database read")
	}

	close(releaseRead)
	select {
	case <-synced:
	case <-time.After(10 * time.Second):
		t.Fatal("the sync did not finish after its read was released")
	}

	common.OptionMapRWMutex.RLock()
	notice := common.OptionMap["Notice"]
	common.OptionMapRWMutex.RUnlock()
	assert.Equal(t, "from-db", notice, "the sync still publishes what it read")
}
