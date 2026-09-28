package common

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/glebarez/go-sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// SQLITE_PATH replaces the whole default DSN, so an operator-supplied path must
// not silently lose the parameters that keep concurrent writers working.
func TestWithSQLitePragmas(t *testing.T) {
	tests := []struct {
		name string
		dsn  string
		want string
	}{
		{
			name: "bare path gets every required parameter",
			dsn:  "/data/one-api.db",
			want: "/data/one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate",
		},
		{
			name: "existing query keeps its separator",
			dsn:  "file:/data/one-api.db?cache=shared",
			want: "file:/data/one-api.db?cache=shared&_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate",
		},
		{
			name: "parameters the operator set are kept",
			dsn:  "one-api.db?_pragma=busy_timeout(60000)&_txlock=deferred",
			want: "one-api.db?_pragma=busy_timeout(60000)&_txlock=deferred&_pragma=journal_mode(WAL)",
		},
		{
			name: "the ignored legacy busy timeout form is completed",
			dsn:  "one-api.db?_busy_timeout=30000",
			want: "one-api.db?_busy_timeout=30000&_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate",
		},
		{
			name: "a fully configured dsn is unchanged",
			dsn:  "one-api.db?_pragma=busy_timeout(60000)&_pragma=journal_mode(WAL)&_txlock=immediate",
			want: "one-api.db?_pragma=busy_timeout(60000)&_pragma=journal_mode(WAL)&_txlock=immediate",
		},
		{
			name: "surrounding whitespace is trimmed",
			dsn:  "  /data/one-api.db  ",
			want: "/data/one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate",
		},
		{
			name: "empty stays empty",
			dsn:  "",
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, withSQLitePragmas(tt.dsn))
		})
	}
}

func TestWithSQLitePragmasConfiguresConnection(t *testing.T) {
	db, err := sql.Open("sqlite", withSQLitePragmas(filepath.Join(t.TempDir(), "pragma.db")))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	var busyTimeout int
	require.NoError(t, db.QueryRow("PRAGMA busy_timeout").Scan(&busyTimeout))
	assert.Equal(t, 30000, busyTimeout)

	var journalMode string
	require.NoError(t, db.QueryRow("PRAGMA journal_mode").Scan(&journalMode))
	assert.Equal(t, "wal", journalMode)
}
