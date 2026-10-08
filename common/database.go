package common

import "strings"

type DatabaseType string

const (
	DatabaseTypeMySQL      DatabaseType = "mysql"
	DatabaseTypeSQLite     DatabaseType = "sqlite"
	DatabaseTypePostgreSQL DatabaseType = "postgres"
	DatabaseTypeClickHouse DatabaseType = "clickhouse"
)

var mainDatabaseType = DatabaseTypeSQLite
var logDatabaseType = DatabaseTypeSQLite

func MainDatabaseType() DatabaseType {
	return mainDatabaseType
}

func LogDatabaseType() DatabaseType {
	return logDatabaseType
}

func SetMainDatabaseType(databaseType DatabaseType) {
	mainDatabaseType = databaseType
}

func SetLogDatabaseType(databaseType DatabaseType) {
	logDatabaseType = databaseType
}

func SetDatabaseTypes(mainType DatabaseType, logType DatabaseType) {
	mainDatabaseType = mainType
	logDatabaseType = logType
}

func UsingMainDatabase(databaseType DatabaseType) bool {
	return mainDatabaseType == databaseType
}

func UsingLogDatabase(databaseType DatabaseType) bool {
	return logDatabaseType == databaseType
}

// SQLitePath is the DSN for the default SQLite database. It uses WAL journal
// mode so readers are never blocked by the single writer, plus a 30s busy
// timeout for writers to queue.
//
// Two details are non-obvious and both are required for concurrent correctness:
//
//  1. The busy timeout must be passed as a `_pragma=busy_timeout(30000)` DSN
//     parameter. The pure-Go driver (modernc.org/sqlite, used through
//     github.com/glebarez/sqlite) silently ignores the plain `_busy_timeout=`
//     form, so without this the effective timeout stays at SQLite's 5s default
//     and concurrent writes surface as "database is locked" (see #6805).
//
//  2. `_txlock=immediate` (BEGIN IMMEDIATE) must be enabled. Without it, a
//     transaction that first SELECTs (establishing a read snapshot) and then
//     writes can hit SQLITE_BUSY_SNAPSHOT when another connection commits in
//     between; the busy handler does not cover that case, so the write fails
//     instantly no matter the timeout. BEGIN IMMEDIATE takes the write lock up
//     front, so writers serialize through the busy timeout instead of dying on
//     a stale snapshot. Autocommit SELECTs stay concurrent because WAL keeps
//     readers unlocked.
var SQLitePath = "one-api.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"

// sqliteConnectionParams are the DSN entries every SQLite connection needs, with
// the marker that identifies an entry the operator already set. They exist so a
// caller-supplied path (SQLITE_PATH) cannot silently drop them: the driver's own
// defaults are a 5s busy timeout and the rollback journal, under which a reader
// waits for the writer and then fails with SQLITE_BUSY.
var sqliteConnectionParams = []struct {
	marker string
	param  string
}{
	{marker: "_pragma=busy_timeout", param: "_pragma=busy_timeout(30000)"},
	{marker: "_pragma=journal_mode", param: "_pragma=journal_mode(WAL)"},
	{marker: "_txlock=", param: "_txlock=immediate"},
}

// WithSQLitePragmas appends the required connection parameters to a
// caller-supplied SQLite DSN, skipping the ones it already sets. Entries the
// caller wrote are kept as they are; the legacy `_busy_timeout=` form does not
// count as setting the busy timeout because the pure-Go driver ignores it.
//
// A SQLite database opened without these parameters does not behave like the
// application: the driver's own defaults use the rollback journal and deferred
// transactions, so a transaction that reads before it writes collides with a
// concurrent writer as an immediate SQLITE_BUSY instead of waiting on the busy
// timeout. Test fixtures that need real concurrent access must go through this
// function rather than sqlite.Open(path) on a bare path.
func WithSQLitePragmas(dsn string) string {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return ""
	}
	missing := make([]string, 0, len(sqliteConnectionParams))
	for _, entry := range sqliteConnectionParams {
		if !strings.Contains(dsn, entry.marker) {
			missing = append(missing, entry.param)
		}
	}
	if len(missing) == 0 {
		return dsn
	}
	separator := "?"
	if strings.Contains(dsn, "?") {
		separator = "&"
	}
	return dsn + separator + strings.Join(missing, "&")
}
