package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// The usage-log page reads a per-user, time-windowed slice of `logs`, while the
// admin page reads a time-windowed slice of the whole table. The admin shape is
// covered by the (created_at, type) index; the per-user shape had no index
// carrying `created_at`, so every COUNT and SUM walked that user's entire
// history and fetched the table row for each entry. On an instance whose
// database sits on slow storage that turned one page load into tens of seconds.
// The (user_id, created_at, type) index is what keeps that window a range scan,
// and GORM only creates it while the model carries the matching tags.
func TestLogPerUserTimeWindowIndex(t *testing.T) {
	for _, dialect := range []struct {
		name string
		env  string
	}{
		{"sqlite", ""},
		{"mysql", "TEST_MYSQL_DSN"},
		{"postgres", "TEST_POSTGRES_DSN"},
	} {
		t.Run(dialect.name, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect.name {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "logs-index.db"))
			case "mysql":
				dsn := os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip(dialect.env + " is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip(dialect.env + " is not configured")
				}
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Log{})) })

			require.NoError(t, db.AutoMigrate(&Log{}))
			assert.True(t, db.Migrator().HasIndex(&Log{}, "idx_logs_user_created_type"),
				"the per-user time-window index must exist after migration")
			// The older indexes stay: the admin page and the per-token page read them.
			for _, kept := range []string{"idx_user_id_id", "idx_created_at_id", "idx_created_at_type", "idx_logs_user_id"} {
				assert.True(t, db.Migrator().HasIndex(&Log{}, kept), "%s must survive the migration", kept)
			}

			// Migrating again must neither fail nor drop what the first run built.
			require.NoError(t, db.AutoMigrate(&Log{}))
			assert.True(t, db.Migrator().HasIndex(&Log{}, "idx_logs_user_created_type"))

			// The index has to be visible in the dialect's own catalog: GORM's
			// HasIndex asks the driver, and a driver that reports a name the
			// server never stored would hide a missing index from every caller.
			var indexName string
			switch dialect.name {
			case "sqlite":
				require.NoError(t, db.Raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'logs' AND name = 'idx_logs_user_created_type'").Scan(&indexName).Error)
			case "mysql":
				require.NoError(t, db.Raw("SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_logs_user_created_type' LIMIT 1").Scan(&indexName).Error)
			case "postgres":
				require.NoError(t, db.Raw("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'logs' AND indexname = 'idx_logs_user_created_type'").Scan(&indexName).Error)
			}
			assert.Equal(t, "idx_logs_user_created_type", indexName,
				"the index must be visible in the dialect's own catalog")

			// Column order is the contract: the leading column has to be the one
			// the per-user query constrains by equality, and the window bound has
			// to come next so SQLite can stop after the window instead of
			// walking the whole history.
			var columns []string
			switch dialect.name {
			case "sqlite":
				require.NoError(t, db.Raw("SELECT name FROM pragma_index_info('idx_logs_user_created_type') ORDER BY seqno").Scan(&columns).Error)
			case "mysql":
				require.NoError(t, db.Raw("SELECT column_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'logs' AND index_name = 'idx_logs_user_created_type' ORDER BY seq_in_index").Scan(&columns).Error)
			case "postgres":
				require.NoError(t, db.Raw(`SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) WHERE c.relname = 'idx_logs_user_created_type' AND a.attnum > 0 ORDER BY array_position(i.indkey, a.attnum)`).Scan(&columns).Error)
			}
			assert.Equal(t, []string{"user_id", "created_at", "type"}, columns)
		})
	}
}
