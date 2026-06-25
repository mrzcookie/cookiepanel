package mongobrowser

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/cookiepanel/cookied/internal/docker"
)

const mongoImage = "mongo:7"

// liveMongo starts a real Mongo container publishing 27017 to a free host port and
// returns a Conn (auto-cleanup). Runs without auth so the container is ready
// without the image's entrypoint user-init (the daemon wraps commands in sh -c,
// which the official entrypoint init doesn't run through) — the auth URI path is
// covered by TestURI. Skips when docker / image pulls aren't available.
func liveMongo(t *testing.T) Conn {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}
	if err := c.PullImage(ctx, mongoImage); err != nil {
		t.Skipf("cannot pull %s: %v", mongoImage, err)
	}

	port := freePort(t)
	id, err := c.CreateContainer(ctx, docker.CreateSpec{
		ServerID:       "mongobrowser-test-server",
		Name:           "cookied-mongobrowser-test",
		Image:          mongoImage,
		StartupCommand: "mongod --bind_ip_all",
		PortBinding: &docker.PortBinding{
			HostIP:        "127.0.0.1",
			HostPort:      port,
			ContainerPort: 27017,
			Protocol:      "tcp",
		},
	})
	if err != nil {
		t.Fatalf("create mongo container: %v", err)
	}
	t.Cleanup(func() { _ = c.RemoveContainer(context.Background(), id, true) })
	if err := c.StartContainer(ctx, id); err != nil {
		t.Fatalf("start mongo container: %v", err)
	}

	conn := Conn{Addr: fmt.Sprintf("127.0.0.1:%d", port)}
	deadline := time.Now().Add(60 * time.Second)
	for {
		if _, err := ListDatabases(ctx, conn); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("mongo did not become ready in time")
		}
		time.Sleep(500 * time.Millisecond)
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

func TestMongoRoundTrip(t *testing.T) {
	conn := liveMongo(t)
	ctx := context.Background()
	const (
		db   = "shop"
		coll = "orders"
	)

	// Creating a collection materializes its database.
	if err := CreateCollection(ctx, conn, db, coll); err != nil {
		t.Fatalf("CreateCollection: %v", err)
	}
	dbs, err := ListDatabases(ctx, conn)
	if err != nil {
		t.Fatalf("ListDatabases: %v", err)
	}
	if !containsDB(dbs, db) {
		t.Fatalf("new db %q not listed: %+v", db, dbs)
	}

	// Insert: one with an explicit string _id (deterministic delete) + one auto.
	if err := InsertDocument(ctx, conn, db, coll, `{"_id":"o1","total":42}`); err != nil {
		t.Fatalf("InsertDocument o1: %v", err)
	}
	if err := InsertDocument(ctx, conn, db, coll, `{"total":7,"items":["a","b"]}`); err != nil {
		t.Fatalf("InsertDocument auto: %v", err)
	}

	page, err := FindDocuments(ctx, conn, db, coll, 0, 25)
	if err != nil {
		t.Fatalf("FindDocuments: %v", err)
	}
	if page.Total != 2 || len(page.Documents) != 2 {
		t.Fatalf("page = total %d, %d docs", page.Total, len(page.Documents))
	}
	if !strings.Contains(page.Documents[0].JSON, "total") {
		t.Errorf("doc json missing fields: %s", page.Documents[0].JSON)
	}

	cols, err := ListCollections(ctx, conn, db)
	if err != nil || len(cols) != 1 || cols[0].Name != coll {
		t.Fatalf("ListCollections = %+v, err %v", cols, err)
	}
	if cols[0].Documents != 2 {
		t.Errorf("collection doc count = %d, want 2", cols[0].Documents)
	}

	// Delete the known-id doc; the count drops.
	if err := DeleteDocument(ctx, conn, db, coll, "o1"); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	if p2, _ := FindDocuments(ctx, conn, db, coll, 0, 25); p2.Total != 1 {
		t.Errorf("after delete, total = %d, want 1", p2.Total)
	}
	if err := DeleteDocument(ctx, conn, db, coll, "o1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting a missing doc = %v, want ErrNotFound", err)
	}

	// Drop the collection, then the database.
	if err := DropCollection(ctx, conn, db, coll); err != nil {
		t.Fatalf("DropCollection: %v", err)
	}
	if err := DropDatabase(ctx, conn, db); err != nil {
		t.Fatalf("DropDatabase: %v", err)
	}
	if dbs, _ := ListDatabases(ctx, conn); containsDB(dbs, db) {
		t.Errorf("db %q still present after drop", db)
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

func TestURI(t *testing.T) {
	withAuth := uri(Conn{Addr: "127.0.0.1:5000", Username: "root", Password: "p@ss word"})
	if !strings.Contains(withAuth, "root:p%40ss+word@127.0.0.1:5000") {
		t.Errorf("auth uri did not url-escape creds: %s", withAuth)
	}
	if !strings.Contains(withAuth, "authSource=admin") || !strings.Contains(withAuth, "directConnection=true") {
		t.Errorf("auth uri missing options: %s", withAuth)
	}
	noAuth := uri(Conn{Addr: "127.0.0.1:5000"})
	if strings.Contains(noAuth, "@") {
		t.Errorf("no-auth uri should have no credentials: %s", noAuth)
	}
}

func TestValidName(t *testing.T) {
	for _, ok := range []string{"shop", "my_db", "orders-2024", "_x"} {
		if err := validName(ok); err != nil {
			t.Errorf("validName(%q) = %v, want nil", ok, err)
		}
	}
	for _, bad := range []string{"", "1bad", "has space", "has.dot", "has$dollar", "a/b", "../etc"} {
		if err := validName(bad); err == nil {
			t.Errorf("validName(%q) = nil, want error", bad)
		}
	}
}

func TestMutableDB(t *testing.T) {
	// Reads may touch system DBs (validName), but mutations must refuse them so a
	// click can't drop `admin` and brick the container's auth.
	for _, sys := range []string{"admin", "local", "config"} {
		if err := validName(sys); err != nil {
			t.Errorf("validName(%q) = %v, want nil (system DBs are browsable)", sys, err)
		}
		if err := mutableDB(sys); !errors.Is(err, ErrInvalid) {
			t.Errorf("mutableDB(%q) = %v, want ErrInvalid", sys, err)
		}
	}
	if err := mutableDB("shop"); err != nil {
		t.Errorf("mutableDB(%q) = %v, want nil", "shop", err)
	}
}
