// Package sqlbrowser is the read/manage surface behind a SQL server's "Browser"
// add-on — a lightweight phpMyAdmin for the two SQL engine families CookiePanel
// ships: PostgreSQL (pgx) and MySQL/MariaDB (go-sql-driver). It connects with the
// admin user + password the panel passes (over the pinned channel; never stored)
// and exposes a database → table → column explorer plus user management and the
// common DDL (create/drop database, create/drop/truncate table, add/drop column,
// create/drop user).
//
// Every op takes a Conn (engine + addr + creds) so the logic is unit-testable
// against a published-port container; the API handler resolves the addr from the
// container itself (see docker.PublishedTCPPort) and never trusts a caller address.
//
// Security: identifiers are validated against an allowlist AND quoted per dialect
// (no metacharacters survive both), column types come from a fixed per-engine set,
// and mutations on the engine's own system databases are refused. The connection
// is always the server's own admin to its own engine, so a crafted password in a
// CREATE USER literal crosses no privilege boundary (the member already owns the
// instance) — it's escaped for correctness, not isolation.
package sqlbrowser

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver
)

// Sentinel errors the API maps onto HTTP status codes.
var (
	ErrNotFound = errors.New("not found")
	ErrInvalid  = errors.New("invalid sql request")
)

const (
	dialTimeout = 8 * time.Second
	opTimeout   = 20 * time.Second
)

// Engine is which SQL family a server runs; it picks the driver, port, and dialect.
type Engine string

const (
	Postgres Engine = "postgres"
	MySQL    Engine = "mysql" // also MariaDB — same wire protocol + driver
)

// ParseEngine validates an engine discriminator from the panel.
func ParseEngine(s string) (Engine, error) {
	switch Engine(s) {
	case Postgres:
		return Postgres, nil
	case MySQL:
		return MySQL, nil
	default:
		return "", fmt.Errorf("%w: unknown engine %q", ErrInvalid, s)
	}
}

// identRE allow-lists a database / table / column / user name: starts with a
// letter or underscore, then alphanumerics/underscores, ≤63 (Postgres truncates
// at 63, MySQL at 64). No quotes or metacharacters, so quoting can't be escaped.
var identRE = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]{0,62}$`)

// hostRE allow-lists a MySQL user host pattern ("%", "localhost", "10.0.0.%", …).
var hostRE = regexp.MustCompile(`^[a-zA-Z0-9_%.:-]{1,255}$`)

// mysqlCharsets are the only character sets CREATE DATABASE accepts (embedded
// literally into DDL, so the allowlist is the injection guard).
var mysqlCharsets = map[string]bool{
	"utf8mb4": true, "utf8": true, "latin1": true, "ascii": true,
}

// commonTypes are column types valid on both engines; each engine adds a few.
var commonTypes = map[string]bool{
	"bigint": true, "int": true, "varchar(255)": true, "text": true,
	"boolean": true, "timestamp": true, "numeric": true,
}

// Conn is everything needed to reach one SQL instance.
type Conn struct {
	Engine   Engine
	Addr     string // host:port, resolved by the caller from the container
	Username string
	Password string
	// Database is the Postgres database to connect to (Postgres binds a connection
	// to one database); "" means the maintenance database. Ignored for MySQL, which
	// reaches every schema from one connection.
	Database string
}

// Database is one database in the listing.
type Database struct {
	Name      string `json:"name"`
	Charset   string `json:"charset"`
	Tables    int64  `json:"tables"` // -1 = not computed (Postgres: cross-db count is unavailable)
	SizeBytes int64  `json:"sizeBytes"`
}

// Table is one table's summary.
type Table struct {
	Name      string `json:"name"`
	Rows      int64  `json:"rows"` // an estimate (both engines report planner estimates)
	SizeBytes int64  `json:"sizeBytes"`
	Columns   int64  `json:"columns"`
}

// Column is one column in a table's structure.
type Column struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Nullable bool    `json:"nullable"`
	Key      string  `json:"key"` // "pk" | "unique" | "index" | ""
	Default  *string `json:"default"`
}

// User is one database user/role.
type User struct {
	Name      string   `json:"name"`
	Host      string   `json:"host"` // MySQL host pattern; "" for Postgres (no host concept)
	Superuser bool     `json:"superuser"`
	Grants    []string `json:"grants"` // database names; ["*"] = all databases
}

// ColumnSpec is a new column to add (key ∈ "", "index", "unique").
type ColumnSpec struct {
	Name     string
	Type     string
	Nullable bool
	Key      string
}

// UserSpec is a new user to create. Access is "*" (all databases / superuser),
// "" (no access), or a single database name.
type UserSpec struct {
	Name     string
	Host     string
	Password string
	Access   string
}

func validIdent(name string) error {
	if !identRE.MatchString(name) {
		return fmt.Errorf("%w: bad identifier %q", ErrInvalid, name)
	}
	return nil
}

func validHost(host string) error {
	if !hostRE.MatchString(host) {
		return fmt.Errorf("%w: bad host %q", ErrInvalid, host)
	}
	return nil
}

// protectedDB reports whether name is one of the engine's own system databases,
// which the browser may read but must never mutate (dropping them bricks the
// instance) — the firewall/OS-drive guard-rail pattern.
func protectedDB(engine Engine, name string) bool {
	switch engine {
	case Postgres:
		return name == "postgres" || name == "template0" || name == "template1"
	default:
		return name == "mysql" || name == "information_schema" ||
			name == "performance_schema" || name == "sys"
	}
}

func mutableDB(engine Engine, name string) error {
	if err := validIdent(name); err != nil {
		return err
	}
	if protectedDB(engine, name) {
		return fmt.Errorf("%w: %s is a system database and can't be modified", ErrInvalid, name)
	}
	return nil
}

func validColumnType(engine Engine, t string) error {
	if commonTypes[t] {
		return nil
	}
	if engine == Postgres && (t == "jsonb" || t == "uuid") {
		return nil
	}
	if engine == MySQL && t == "json" {
		return nil
	}
	return fmt.Errorf("%w: unsupported column type %q", ErrInvalid, t)
}

// quote wraps a (validated) identifier in the engine's quoting so it's a literal
// name. identRE has already rejected the quote chars, so this can't be escaped.
func (c Conn) quote(name string) string {
	if c.Engine == MySQL {
		return "`" + name + "`"
	}
	return `"` + name + `"`
}

// dsn builds the driver name + connection string for database/sql. Both forms
// escape the credentials (url.UserPassword / mysql.Config.FormatDSN).
func (c Conn) dsn() (string, string) {
	if c.Engine == Postgres {
		dbname := c.Database
		if dbname == "" {
			dbname = "postgres"
		}
		u := url.URL{
			Scheme: "postgres",
			User:   url.UserPassword(c.Username, c.Password),
			Host:   c.Addr,
			Path:   "/" + dbname,
		}
		q := url.Values{}
		q.Set("sslmode", "disable")
		q.Set("connect_timeout", "8")
		// Pin standard-conforming strings on so pgLiteral's '→'' escaping of the
		// CREATE ROLE password is correct even if the server defaults it off.
		q.Set("options", "-c standard_conforming_strings=on")
		u.RawQuery = q.Encode()
		return "pgx", u.String()
	}
	cfg := mysqldriver.NewConfig()
	cfg.User = c.Username
	cfg.Passwd = c.Password
	cfg.Net = "tcp"
	cfg.Addr = c.Addr
	cfg.DBName = c.Database
	cfg.Timeout = dialTimeout
	cfg.ReadTimeout = opTimeout
	cfg.WriteTimeout = opTimeout
	cfg.Loc = time.UTC
	cfg.Params = map[string]string{"charset": "utf8mb4"}
	return "mysql", cfg.FormatDSN()
}

// open dials and pings; the caller defers Close.
func (c Conn) open(ctx context.Context) (*sql.DB, error) {
	driver, dsn := c.dsn()
	db, err := sql.Open(driver, dsn)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	db.SetMaxOpenConns(3)
	db.SetConnMaxLifetime(time.Minute)
	pctx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	if err := db.PingContext(pctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect: %w", err)
	}
	return db, nil
}

// onDB connects to a specific Postgres database (a no-op copy for MySQL, which
// doesn't bind connections to a database).
func (c Conn) onDB(dbName string) Conn {
	if c.Engine == Postgres {
		c.Database = dbName
	}
	return c
}

// ─── databases ───────────────────────────────────────────────────────────────

// ListDatabases returns the instance's user databases (system schemas excluded).
func ListDatabases(ctx context.Context, conn Conn) ([]Database, error) {
	db, err := conn.open(ctx)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if conn.Engine == Postgres {
		rows, err := db.QueryContext(ctx, `
			SELECT d.datname, pg_encoding_to_char(d.encoding), pg_database_size(d.datname)
			FROM pg_database d
			WHERE d.datistemplate = false AND d.datallowconn = true AND d.datname <> 'postgres'
			ORDER BY d.datname`)
		if err != nil {
			return nil, fmt.Errorf("list databases: %w", err)
		}
		defer rows.Close()
		out := []Database{}
		for rows.Next() {
			var d Database
			d.Tables = -1 // a per-db table count needs one connection per database
			if err := rows.Scan(&d.Name, &d.Charset, &d.SizeBytes); err != nil {
				return nil, err
			}
			out = append(out, d)
		}
		return out, rows.Err()
	}

	rows, err := db.QueryContext(ctx, `
		SELECT s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME,
			(SELECT COUNT(*) FROM information_schema.TABLES t
			 WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME AND t.TABLE_TYPE = 'BASE TABLE'),
			COALESCE((SELECT SUM(t.DATA_LENGTH + t.INDEX_LENGTH) FROM information_schema.TABLES t
			 WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME), 0)
		FROM information_schema.SCHEMATA s
		WHERE s.SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
		ORDER BY s.SCHEMA_NAME`)
	if err != nil {
		return nil, fmt.Errorf("list databases: %w", err)
	}
	defer rows.Close()
	out := []Database{}
	for rows.Next() {
		var d Database
		if err := rows.Scan(&d.Name, &d.Charset, &d.Tables, &d.SizeBytes); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// CreateDatabase creates an empty database (charset applies to MySQL only;
// Postgres inherits the template encoding).
func CreateDatabase(ctx context.Context, conn Conn, dbName, charset string) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()

	if conn.Engine == Postgres {
		// CREATE DATABASE can't run in a transaction; a plain Exec autocommits.
		_, err = db.ExecContext(ctx, "CREATE DATABASE "+conn.quote(dbName))
		return wrapExec("create database", err)
	}
	cs := "utf8mb4"
	if charset != "" {
		if !mysqlCharsets[charset] {
			return fmt.Errorf("%w: unsupported charset %q", ErrInvalid, charset)
		}
		cs = charset
	}
	_, err = db.ExecContext(ctx, "CREATE DATABASE "+conn.quote(dbName)+" CHARACTER SET "+cs)
	return wrapExec("create database", err)
}

// DropDatabase drops a database and everything in it.
func DropDatabase(ctx context.Context, conn Conn, dbName string) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	db, err := conn.open(ctx) // maintenance connection (not bound to the target)
	if err != nil {
		return err
	}
	defer db.Close()

	stmt := "DROP DATABASE " + conn.quote(dbName)
	if conn.Engine == Postgres {
		stmt += " WITH (FORCE)" // terminate other sessions so the drop succeeds
	}
	_, err = db.ExecContext(ctx, stmt)
	return wrapExec("drop database", err)
}

// ─── tables ──────────────────────────────────────────────────────────────────

// ListTables returns a database's base tables with row/size/column summaries.
func ListTables(ctx context.Context, conn Conn, dbName string) ([]Table, error) {
	if err := validIdent(dbName); err != nil {
		return nil, err
	}
	if conn.Engine == Postgres {
		db, err := conn.onDB(dbName).open(ctx)
		if err != nil {
			return nil, err
		}
		defer db.Close()
		rows, err := db.QueryContext(ctx, `
			SELECT c.relname,
				GREATEST(c.reltuples::bigint, 0),
				pg_total_relation_size(c.oid),
				(SELECT COUNT(*) FROM information_schema.columns col
				 WHERE col.table_schema = 'public' AND col.table_name = c.relname)
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'public' AND c.relkind = 'r'
			ORDER BY c.relname`)
		if err != nil {
			return nil, fmt.Errorf("list tables: %w", err)
		}
		defer rows.Close()
		return scanTables(rows)
	}

	db, err := conn.open(ctx)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `
		SELECT t.TABLE_NAME, COALESCE(t.TABLE_ROWS, 0),
			COALESCE(t.DATA_LENGTH + t.INDEX_LENGTH, 0),
			(SELECT COUNT(*) FROM information_schema.COLUMNS col
			 WHERE col.TABLE_SCHEMA = ? AND col.TABLE_NAME = t.TABLE_NAME)
		FROM information_schema.TABLES t
		WHERE t.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
		ORDER BY t.TABLE_NAME`, dbName, dbName)
	if err != nil {
		return nil, fmt.Errorf("list tables: %w", err)
	}
	defer rows.Close()
	return scanTables(rows)
}

func scanTables(rows *sql.Rows) ([]Table, error) {
	out := []Table{}
	for rows.Next() {
		var t Table
		if err := rows.Scan(&t.Name, &t.Rows, &t.SizeBytes, &t.Columns); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CreateTable creates a table with a single auto-incrementing id primary key.
func CreateTable(ctx context.Context, conn Conn, dbName, table string) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	if err := validIdent(table); err != nil {
		return err
	}
	if conn.Engine == Postgres {
		db, err := conn.onDB(dbName).open(ctx)
		if err != nil {
			return err
		}
		defer db.Close()
		_, err = db.ExecContext(ctx,
			`CREATE TABLE "public".`+conn.quote(table)+` (id BIGSERIAL PRIMARY KEY)`)
		return wrapExec("create table", err)
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		"CREATE TABLE "+conn.quote(dbName)+"."+conn.quote(table)+
			" (id BIGINT AUTO_INCREMENT PRIMARY KEY)")
	return wrapExec("create table", err)
}

// DropTable drops a table and all its data.
func DropTable(ctx context.Context, conn Conn, dbName, table string) error {
	return alterTable(ctx, conn, dbName, table, "DROP TABLE %s")
}

// TruncateTable deletes every row in a table, keeping its structure.
func TruncateTable(ctx context.Context, conn Conn, dbName, table string) error {
	return alterTable(ctx, conn, dbName, table, "TRUNCATE TABLE %s")
}

// alterTable runs a single statement of the form "<verb> <qualified-table>".
func alterTable(ctx context.Context, conn Conn, dbName, table, format string) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	if err := validIdent(table); err != nil {
		return err
	}
	if conn.Engine == Postgres {
		db, err := conn.onDB(dbName).open(ctx)
		if err != nil {
			return err
		}
		defer db.Close()
		qualified := `"public".` + conn.quote(table)
		_, err = db.ExecContext(ctx, fmt.Sprintf(format, qualified))
		return wrapExec("alter table", err)
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	qualified := conn.quote(dbName) + "." + conn.quote(table)
	_, err = db.ExecContext(ctx, fmt.Sprintf(format, qualified))
	return wrapExec("alter table", err)
}

// ─── columns ─────────────────────────────────────────────────────────────────

// ListColumns returns a table's columns with type/nullability/key/default.
func ListColumns(ctx context.Context, conn Conn, dbName, table string) ([]Column, error) {
	if err := validIdent(dbName); err != nil {
		return nil, err
	}
	if err := validIdent(table); err != nil {
		return nil, err
	}
	if conn.Engine == Postgres {
		return postgresColumns(ctx, conn.onDB(dbName), table)
	}
	return mysqlColumns(ctx, conn, dbName, table)
}

func mysqlColumns(ctx context.Context, conn Conn, dbName, table string) ([]Column, error) {
	db, err := conn.open(ctx)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `
		SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, dbName, table)
	if err != nil {
		return nil, fmt.Errorf("list columns: %w", err)
	}
	defer rows.Close()
	out := []Column{}
	for rows.Next() {
		var (
			c        Column
			nullable string
			key      string
		)
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &key, &c.Default); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		switch key {
		case "PRI":
			c.Key = "pk"
		case "UNI":
			c.Key = "unique"
		case "MUL":
			c.Key = "index"
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func postgresColumns(ctx context.Context, conn Conn, table string) ([]Column, error) {
	db, err := conn.open(ctx)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	// Column keys (pk / unique / indexed), merged in below.
	keyRows, err := db.QueryContext(ctx, `
		SELECT a.attname, bool_or(ix.indisprimary), bool_or(ix.indisunique)
		FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
		JOIN pg_index ix ON ix.indrelid = t.oid
		JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
		WHERE n.nspname = 'public' AND t.relname = $1
		GROUP BY a.attname`, table)
	if err != nil {
		return nil, fmt.Errorf("column keys: %w", err)
	}
	keys := map[string]string{}
	for keyRows.Next() {
		var (
			name              string
			isPrimary, unique bool
		)
		if err := keyRows.Scan(&name, &isPrimary, &unique); err != nil {
			keyRows.Close()
			return nil, err
		}
		switch {
		case isPrimary:
			keys[name] = "pk"
		case unique:
			keys[name] = "unique"
		default:
			keys[name] = "index"
		}
	}
	keyRows.Close()
	if err := keyRows.Err(); err != nil {
		return nil, err
	}

	rows, err := db.QueryContext(ctx, `
		SELECT column_name,
			CASE WHEN data_type = 'character varying' AND character_maximum_length IS NOT NULL
				THEN 'varchar(' || character_maximum_length || ')'
				ELSE data_type END,
			is_nullable, column_default
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = $1
		ORDER BY ordinal_position`, table)
	if err != nil {
		return nil, fmt.Errorf("list columns: %w", err)
	}
	defer rows.Close()
	out := []Column{}
	for rows.Next() {
		var (
			c        Column
			nullable string
		)
		if err := rows.Scan(&c.Name, &c.Type, &nullable, &c.Default); err != nil {
			return nil, err
		}
		c.Nullable = nullable == "YES"
		c.Key = keys[c.Name]
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddColumn adds a column (key ∈ "", "index", "unique").
func AddColumn(ctx context.Context, conn Conn, dbName, table string, col ColumnSpec) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	if err := validIdent(table); err != nil {
		return err
	}
	if err := validIdent(col.Name); err != nil {
		return err
	}
	if err := validColumnType(conn.Engine, col.Type); err != nil {
		return err
	}
	if col.Key != "" && col.Key != "index" && col.Key != "unique" {
		return fmt.Errorf("%w: bad key %q", ErrInvalid, col.Key)
	}
	null := "NULL"
	if !col.Nullable {
		null = "NOT NULL"
	}

	if conn.Engine == Postgres {
		db, err := conn.onDB(dbName).open(ctx)
		if err != nil {
			return err
		}
		defer db.Close()
		tbl := `"public".` + conn.quote(table)
		if _, err := db.ExecContext(ctx,
			"ALTER TABLE "+tbl+" ADD COLUMN "+conn.quote(col.Name)+" "+col.Type+" "+null); err != nil {
			return wrapExec("add column", err)
		}
		switch col.Key {
		case "unique":
			_, err = db.ExecContext(ctx, "CREATE UNIQUE INDEX ON "+tbl+" ("+conn.quote(col.Name)+")")
		case "index":
			_, err = db.ExecContext(ctx, "CREATE INDEX ON "+tbl+" ("+conn.quote(col.Name)+")")
		}
		return wrapExec("add index", err)
	}

	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	tbl := conn.quote(dbName) + "." + conn.quote(table)
	stmt := "ALTER TABLE " + tbl + " ADD COLUMN " + conn.quote(col.Name) + " " + col.Type + " " + null
	switch col.Key {
	case "unique":
		stmt += ", ADD UNIQUE (" + conn.quote(col.Name) + ")"
	case "index":
		stmt += ", ADD INDEX (" + conn.quote(col.Name) + ")"
	}
	_, err = db.ExecContext(ctx, stmt)
	return wrapExec("add column", err)
}

// DropColumn drops a column from a table.
func DropColumn(ctx context.Context, conn Conn, dbName, table, column string) error {
	if err := mutableDB(conn.Engine, dbName); err != nil {
		return err
	}
	if err := validIdent(table); err != nil {
		return err
	}
	if err := validIdent(column); err != nil {
		return err
	}
	if conn.Engine == Postgres {
		db, err := conn.onDB(dbName).open(ctx)
		if err != nil {
			return err
		}
		defer db.Close()
		_, err = db.ExecContext(ctx,
			`ALTER TABLE "public".`+conn.quote(table)+" DROP COLUMN "+conn.quote(column))
		return wrapExec("drop column", err)
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()
	_, err = db.ExecContext(ctx,
		"ALTER TABLE "+conn.quote(dbName)+"."+conn.quote(table)+" DROP COLUMN "+conn.quote(column))
	return wrapExec("drop column", err)
}

// ─── users ───────────────────────────────────────────────────────────────────

// ListUsers returns the engine's login users/roles with their access summary.
func ListUsers(ctx context.Context, conn Conn) ([]User, error) {
	db, err := conn.open(ctx)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if conn.Engine == Postgres {
		return postgresUsers(ctx, db)
	}
	return mysqlUsers(ctx, db)
}

func mysqlUsers(ctx context.Context, db *sql.DB) ([]User, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT User, Host, IF(Super_priv = 'Y', 1, 0) FROM mysql.user ORDER BY User, Host`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var (
			u     User
			super int
		)
		if err := rows.Scan(&u.Name, &u.Host, &super); err != nil {
			return nil, err
		}
		u.Grants = []string{}
		u.Superuser = super == 1
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Per-user grants (bounded by user count). SHOW GRANTS can't be parameterized;
	// the name/host come straight from mysql.user, but validate before interpolating.
	for i := range out {
		if validIdent(out[i].Name) != nil || validHost(out[i].Host) != nil {
			continue
		}
		grants, all := mysqlGrants(ctx, db, out[i].Name, out[i].Host)
		out[i].Grants = grants
		if all {
			out[i].Superuser = true
		}
	}
	return out, nil
}

// mysqlGrants parses SHOW GRANTS into the databases a user can use; all reports a
// real privilege on *.* (USAGE — the no-privilege default — doesn't count).
var grantLineRE = regexp.MustCompile(`^GRANT (.+?) ON (\S+?)\.(\S+?) TO`)

func mysqlGrants(ctx context.Context, db *sql.DB, name, host string) ([]string, bool) {
	rows, err := db.QueryContext(ctx, "SHOW GRANTS FOR '"+name+"'@'"+host+"'")
	if err != nil {
		return []string{}, false
	}
	defer rows.Close()
	dbs := []string{}
	all := false
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return dbs, all
		}
		m := grantLineRE.FindStringSubmatch(line)
		if m == nil || strings.EqualFold(m[1], "USAGE") {
			continue
		}
		scope := strings.Trim(m[2], "`")
		if scope == "*" {
			all = true
			continue
		}
		dbs = append(dbs, scope)
	}
	if all {
		return []string{"*"}, true
	}
	return dbs, false
}

func postgresUsers(ctx context.Context, db *sql.DB) ([]User, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT rolname, rolsuper FROM pg_roles
		WHERE rolcanlogin = true AND rolname NOT LIKE 'pg\_%'
		ORDER BY rolname`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.Name, &u.Superuser); err != nil {
			return nil, err
		}
		u.Grants = []string{}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Grants = databases the role holds CREATE on (not a PUBLIC default, so it
	// reflects an explicit grant). Superusers bypass checks → "*".
	for i := range out {
		if out[i].Superuser {
			out[i].Grants = []string{"*"}
			continue
		}
		out[i].Grants = postgresRoleDatabases(ctx, db, out[i].Name)
	}
	return out, nil
}

func postgresRoleDatabases(ctx context.Context, db *sql.DB, role string) []string {
	rows, err := db.QueryContext(ctx, `
		SELECT d.datname FROM pg_database d
		WHERE NOT d.datistemplate AND d.datallowconn AND d.datname <> 'postgres'
			AND has_database_privilege($1, d.datname, 'CREATE')
		ORDER BY d.datname`, role)
	if err != nil {
		return []string{}
	}
	defer rows.Close()
	dbs := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return dbs
		}
		dbs = append(dbs, name)
	}
	return dbs
}

// CreateUser creates a login user/role and grants the requested access.
func CreateUser(ctx context.Context, conn Conn, spec UserSpec) error {
	if err := validIdent(spec.Name); err != nil {
		return err
	}
	if spec.Access != "" && spec.Access != "*" {
		if err := validIdent(spec.Access); err != nil {
			return err
		}
	}
	if len(spec.Password) > 256 {
		return fmt.Errorf("%w: password too long", ErrInvalid)
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()

	if conn.Engine == Postgres {
		role := conn.quote(spec.Name)
		if spec.Access == "*" {
			_, err = db.ExecContext(ctx,
				"CREATE ROLE "+role+" LOGIN SUPERUSER PASSWORD "+pgLiteral(spec.Password))
			return wrapExec("create user", err)
		}
		if _, err := db.ExecContext(ctx,
			"CREATE ROLE "+role+" LOGIN PASSWORD "+pgLiteral(spec.Password)); err != nil {
			return wrapExec("create user", err)
		}
		if spec.Access != "" {
			_, err = db.ExecContext(ctx,
				"GRANT ALL PRIVILEGES ON DATABASE "+conn.quote(spec.Access)+" TO "+role)
		}
		return wrapExec("grant", err)
	}

	if err := validHost(spec.Host); err != nil {
		return err
	}
	user := "'" + spec.Name + "'@'" + spec.Host + "'" // name/host already allowlisted
	if _, err := db.ExecContext(ctx,
		"CREATE USER "+user+" IDENTIFIED BY "+mysqlLiteral(spec.Password)); err != nil {
		return wrapExec("create user", err)
	}
	switch spec.Access {
	case "*":
		_, err = db.ExecContext(ctx, "GRANT ALL PRIVILEGES ON *.* TO "+user+" WITH GRANT OPTION")
	case "":
		// no grant
	default:
		_, err = db.ExecContext(ctx,
			"GRANT ALL PRIVILEGES ON "+conn.quote(spec.Access)+".* TO "+user)
	}
	if err != nil {
		return wrapExec("grant", err)
	}
	_, err = db.ExecContext(ctx, "FLUSH PRIVILEGES")
	return wrapExec("flush", err)
}

// DropUser drops a user/role. The admin we connect as can't drop itself
// (self-lockout guard, like the firewall refusing its own port).
func DropUser(ctx context.Context, conn Conn, name, host string) error {
	if err := validIdent(name); err != nil {
		return err
	}
	if name == conn.Username {
		return fmt.Errorf("%w: refusing to drop the admin user", ErrInvalid)
	}
	db, err := conn.open(ctx)
	if err != nil {
		return err
	}
	defer db.Close()

	if conn.Engine == Postgres {
		// A role can't be dropped while it holds privileges (e.g. a GRANT on a
		// database) or owns objects. DROP OWNED BY revokes those — from the
		// maintenance connection it also clears shared (database-level) grants.
		_, _ = db.ExecContext(ctx, "DROP OWNED BY "+conn.quote(name))
		_, err = db.ExecContext(ctx, "DROP ROLE "+conn.quote(name))
		return wrapExec("drop user", err)
	}
	if err := validHost(host); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, "DROP USER '"+name+"'@'"+host+"'"); err != nil {
		return wrapExec("drop user", err)
	}
	_, err = db.ExecContext(ctx, "FLUSH PRIVILEGES")
	return wrapExec("flush", err)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// pgLiteral quotes a string for a Postgres SQL literal (standard_conforming_strings
// is on by default, so only the single quote needs doubling).
func pgLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

// mysqlLiteral quotes a string for a MySQL SQL literal (backslash escapes are on
// by default, so both the backslash and the single quote need escaping).
func mysqlLiteral(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "'", "''")
	return "'" + s + "'"
}

// wrapExec adds context to a DDL error (nil stays nil).
func wrapExec(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", what, err)
}
