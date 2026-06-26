package sqlbrowser

import (
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/xena-studios/raptor/apps/wings/internal/docker"
)

// liveDB starts a real database container publishing its port to a free host port
// and returns a Conn (auto-cleanup). It leaves StartupCommand empty so the image's
// own entrypoint runs initdb with the password env — giving a real authenticated
// instance. Skips when docker / image pulls aren't available.
func liveDB(t *testing.T, engine Engine, image string, env map[string]string, port int, user string) Conn {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}
	if err := c.PullImage(ctx, image); err != nil {
		t.Skipf("cannot pull %s: %v", image, err)
	}

	host := freePort(t)
	id, err := c.CreateContainer(ctx, docker.CreateSpec{
		ServerID: "sqlbrowser-test-server",
		Name:     fmt.Sprintf("wings-sqlbrowser-test-%s", engine),
		Image:    image,
		Env:      env,
		PortBinding: &docker.PortBinding{
			HostIP:        "127.0.0.1",
			HostPort:      host,
			ContainerPort: port,
			Protocol:      "tcp",
		},
	})
	if err != nil {
		t.Fatalf("create %s container: %v", engine, err)
	}
	t.Cleanup(func() { _ = c.RemoveContainer(context.Background(), id, true) })
	if err := c.StartContainer(ctx, id); err != nil {
		t.Fatalf("start %s container: %v", engine, err)
	}

	conn := Conn{
		Engine:   engine,
		Addr:     fmt.Sprintf("127.0.0.1:%d", host),
		Username: user,
		Password: env["POSTGRES_PASSWORD"] + env["MARIADB_ROOT_PASSWORD"],
	}
	deadline := time.Now().Add(100 * time.Second)
	for {
		if _, err := ListDatabases(ctx, conn); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s did not become ready in time", engine)
		}
		time.Sleep(time.Second)
	}
	return conn
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("find free port: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func TestPostgresRoundTrip(t *testing.T) {
	conn := liveDB(t, Postgres, "postgres:16-alpine",
		map[string]string{"POSTGRES_PASSWORD": "s3cret"}, 5432, "postgres")
	roundTrip(t, conn)
}

func TestMySQLRoundTrip(t *testing.T) {
	// MariaDB shares the MySQL wire protocol + driver + dialect, and inits far
	// faster than mysql:8.4 — it exercises the exact MySQL engine code path.
	conn := liveDB(t, MySQL, "mariadb:11.4",
		map[string]string{"MARIADB_ROOT_PASSWORD": "s3cret"}, 3306, "root")
	roundTrip(t, conn)
}

// roundTrip drives the full surface against a live instance of either engine.
func roundTrip(t *testing.T, conn Conn) {
	ctx := context.Background()
	const (
		dbName = "shop"
		table  = "orders"
	)

	if err := CreateDatabase(ctx, conn, dbName, "utf8mb4"); err != nil {
		t.Fatalf("CreateDatabase: %v", err)
	}
	dbs, err := ListDatabases(ctx, conn)
	if err != nil {
		t.Fatalf("ListDatabases: %v", err)
	}
	if !containsDB(dbs, dbName) {
		t.Fatalf("new db %q not listed: %+v", dbName, dbs)
	}

	if err := CreateTable(ctx, conn, dbName, table); err != nil {
		t.Fatalf("CreateTable: %v", err)
	}
	if err := AddColumn(ctx, conn, dbName, table, ColumnSpec{
		Name: "total", Type: "numeric", Nullable: true, Key: "index",
	}); err != nil {
		t.Fatalf("AddColumn: %v", err)
	}

	tables, err := ListTables(ctx, conn, dbName)
	if err != nil || len(tables) != 1 || tables[0].Name != table {
		t.Fatalf("ListTables = %+v, err %v", tables, err)
	}
	if tables[0].Columns != 2 {
		t.Errorf("column count = %d, want 2 (id + total)", tables[0].Columns)
	}

	cols, err := ListColumns(ctx, conn, dbName, table)
	if err != nil {
		t.Fatalf("ListColumns: %v", err)
	}
	if len(cols) != 2 {
		t.Fatalf("columns = %d, want 2: %+v", len(cols), cols)
	}
	if cols[0].Name != "id" || cols[0].Key != "pk" {
		t.Errorf("first column = %+v, want id/pk", cols[0])
	}
	if cols[1].Name != "total" || cols[1].Key != "index" {
		t.Errorf("second column = %+v, want total/index", cols[1])
	}

	// Users: create with access to the new db, see it listed, then drop.
	if err := CreateUser(ctx, conn, UserSpec{
		Name: "app_rw", Host: "%", Password: "p@ss'w\\ord", Access: dbName,
	}); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	users, err := ListUsers(ctx, conn)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	appUser := findUser(users, "app_rw")
	if appUser == nil {
		t.Fatalf("created user not listed: %+v", users)
	}
	if !containsStr(appUser.Grants, dbName) {
		t.Errorf("user grants = %v, want to include %q", appUser.Grants, dbName)
	}

	// Dropping the admin we connect as is refused.
	if err := DropUser(ctx, conn, conn.Username, "%"); err == nil {
		t.Error("DropUser(admin) succeeded, want refusal")
	}
	if err := DropUser(ctx, conn, "app_rw", "%"); err != nil {
		t.Fatalf("DropUser: %v", err)
	}

	// Truncate, drop column, drop table, drop database.
	if err := TruncateTable(ctx, conn, dbName, table); err != nil {
		t.Errorf("TruncateTable: %v", err)
	}
	if err := DropColumn(ctx, conn, dbName, table, "total"); err != nil {
		t.Errorf("DropColumn: %v", err)
	}
	if err := DropTable(ctx, conn, dbName, table); err != nil {
		t.Errorf("DropTable: %v", err)
	}
	if err := DropDatabase(ctx, conn, dbName); err != nil {
		t.Fatalf("DropDatabase: %v", err)
	}
	if dbs, _ := ListDatabases(ctx, conn); containsDB(dbs, dbName) {
		t.Errorf("db %q still present after drop", dbName)
	}

	// A system database can't be dropped.
	sys := "mysql"
	if conn.Engine == Postgres {
		sys = "postgres"
	}
	if err := DropDatabase(ctx, conn, sys); err == nil {
		t.Errorf("DropDatabase(%q) succeeded, want refusal", sys)
	}
}

func containsDB(dbs []Database, name string) bool {
	for _, d := range dbs {
		if d.Name == name {
			return true
		}
	}
	return false
}

func findUser(users []User, name string) *User {
	for i := range users {
		if users[i].Name == name {
			return &users[i]
		}
	}
	return nil
}

func containsStr(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}

func TestDSN(t *testing.T) {
	pgDriver, pgDSN := Conn{
		Engine: Postgres, Addr: "127.0.0.1:5432",
		Username: "postgres", Password: "p@ss word/:?", Database: "shop",
	}.dsn()
	if pgDriver != "pgx" {
		t.Errorf("postgres driver = %q, want pgx", pgDriver)
	}
	if !strings.Contains(pgDSN, "p%40ss%20word") {
		t.Errorf("postgres dsn did not escape the password: %s", pgDSN)
	}
	if !strings.Contains(pgDSN, "/shop") || !strings.Contains(pgDSN, "sslmode=disable") {
		t.Errorf("postgres dsn missing db/options: %s", pgDSN)
	}

	myDriver, myDSN := Conn{
		Engine: MySQL, Addr: "127.0.0.1:3306",
		Username: "root", Password: "p@ss:w/ord", Database: "shop",
	}.dsn()
	if myDriver != "mysql" {
		t.Errorf("mysql driver = %q, want mysql", myDriver)
	}
	if !strings.Contains(myDSN, "tcp(127.0.0.1:3306)") || !strings.Contains(myDSN, "/shop") {
		t.Errorf("mysql dsn malformed: %s", myDSN)
	}
}

func TestValidIdent(t *testing.T) {
	for _, ok := range []string{"shop", "my_db", "_x", "orders2024"} {
		if err := validIdent(ok); err != nil {
			t.Errorf("validIdent(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"", "1bad", "has space", "has-dash", "has.dot", "a;b", "a`b", `a"b`, "../x"} {
		if err := validIdent(bad); err == nil {
			t.Errorf("validIdent(%q) = nil, want error", bad)
		}
	}
}

func TestProtectedDB(t *testing.T) {
	for _, sys := range []string{"postgres", "template0", "template1"} {
		if !protectedDB(Postgres, sys) {
			t.Errorf("protectedDB(pg, %q) = false, want true", sys)
		}
		if mutableDB(Postgres, sys) == nil {
			t.Errorf("mutableDB(pg, %q) = nil, want error", sys)
		}
	}
	for _, sys := range []string{"mysql", "information_schema", "performance_schema", "sys"} {
		if !protectedDB(MySQL, sys) {
			t.Errorf("protectedDB(mysql, %q) = false, want true", sys)
		}
	}
	if protectedDB(Postgres, "shop") || protectedDB(MySQL, "shop") {
		t.Error("user db 'shop' wrongly flagged system")
	}
}

func TestParseEngine(t *testing.T) {
	for _, ok := range []string{"postgres", "mysql"} {
		if _, err := ParseEngine(ok); err != nil {
			t.Errorf("ParseEngine(%q) = %v, want nil", ok, err)
		}
	}
	if _, err := ParseEngine("mssql"); err == nil {
		t.Error("ParseEngine(mssql) = nil, want error")
	}
}
