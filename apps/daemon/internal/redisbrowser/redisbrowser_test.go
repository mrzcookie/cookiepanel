package redisbrowser

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

const (
	redisImage = "redis:7-alpine"
	testPass   = "s3cr3t-pass"
)

// liveRedis starts a real Redis container publishing 6379 to a free host port and
// returns a Conn pointing at it (plus auto-cleanup). Skips when docker/image pulls
// aren't available — same posture as the backup tests.
func liveRedis(t *testing.T) Conn {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}
	if err := c.PullImage(ctx, redisImage); err != nil {
		t.Skipf("cannot pull %s: %v", redisImage, err)
	}

	port := freePort(t)
	const serverID = "redisbrowser-test-server"
	id, err := c.CreateContainer(ctx, docker.CreateSpec{
		ServerID:       serverID,
		Name:           "cookied-redisbrowser-test",
		Image:          redisImage,
		StartupCommand: "redis-server --requirepass " + testPass + " --save '' --appendonly no",
		PortBinding: &docker.PortBinding{
			HostIP:        "127.0.0.1",
			HostPort:      port,
			ContainerPort: 6379,
			Protocol:      "tcp",
		},
	})
	if err != nil {
		t.Fatalf("create redis container: %v", err)
	}
	t.Cleanup(func() { _ = c.RemoveContainer(context.Background(), id, true) })
	if err := c.StartContainer(ctx, id); err != nil {
		t.Fatalf("start redis container: %v", err)
	}

	conn := Conn{Addr: fmt.Sprintf("127.0.0.1:%d", port), Password: testPass, DB: 0}
	// Wait for Redis to accept connections.
	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, err := GetOverview(ctx, conn); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("redis did not become ready in time")
		}
		time.Sleep(300 * time.Millisecond)
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

func TestRedisRoundTrip(t *testing.T) {
	conn := liveRedis(t)
	ctx := context.Background()

	// Seed one key of every type, mixing TTLs.
	seed := []SetRequest{
		{Key: "str:1", Type: "string", String: "hello", TTLSeconds: -1},
		{Key: "hash:1", Type: "hash", Fields: []Field{{"a", "1"}, {"b", "2"}}, TTLSeconds: 3600},
		{Key: "list:1", Type: "list", Items: []string{"x", "y", "z"}, TTLSeconds: -1},
		{Key: "set:1", Type: "set", Items: []string{"m", "n"}, TTLSeconds: -1},
		{Key: "zset:1", Type: "zset", Members: []ScoreMember{{"lo", 1}, {"hi", 9}}, TTLSeconds: -1},
	}
	for _, r := range seed {
		if err := SetKey(ctx, conn, r); err != nil {
			t.Fatalf("SetKey %s: %v", r.Key, err)
		}
	}

	// Overview reflects the 5 keys.
	ov, err := GetOverview(ctx, conn)
	if err != nil {
		t.Fatalf("GetOverview: %v", err)
	}
	if ov.Version == "" {
		t.Error("overview has no version")
	}
	total := int64(0)
	for _, db := range ov.Databases {
		if db.DB == 0 {
			total = db.Keys
		}
	}
	if total != 5 {
		t.Errorf("db0 keys = %d, want 5", total)
	}

	// Scan returns all 5 with correct types.
	page, err := ScanKeys(ctx, conn, "*", "0", 100)
	if err != nil {
		t.Fatalf("ScanKeys: %v", err)
	}
	byKey := map[string]KeySummary{}
	for _, k := range page.Keys {
		byKey[k.Key] = k
	}
	if len(byKey) != 5 {
		t.Fatalf("scan returned %d keys, want 5", len(byKey))
	}
	if byKey["hash:1"].Type != "hash" || byKey["zset:1"].Type != "zset" {
		t.Errorf("scan types wrong: %+v", page.Keys)
	}
	if byKey["hash:1"].TTLSeconds <= 0 {
		t.Errorf("hash:1 should have a positive TTL, got %d", byKey["hash:1"].TTLSeconds)
	}
	if byKey["str:1"].TTLSeconds != -1 {
		t.Errorf("str:1 should have no expiry (-1), got %d", byKey["str:1"].TTLSeconds)
	}

	// Type-aware inspection.
	str, err := GetKey(ctx, conn, "str:1")
	if err != nil || str.String != "hello" {
		t.Fatalf("GetKey str:1 = %+v, err %v", str, err)
	}
	zset, err := GetKey(ctx, conn, "zset:1")
	if err != nil {
		t.Fatalf("GetKey zset:1: %v", err)
	}
	if len(zset.Members) != 2 || zset.Members[0].Member != "lo" || zset.Members[1].Score != 9 {
		t.Errorf("zset members wrong: %+v", zset.Members)
	}
	hash, _ := GetKey(ctx, conn, "hash:1")
	if len(hash.Fields) != 2 {
		t.Errorf("hash fields = %d, want 2", len(hash.Fields))
	}

	// TTL: persist hash:1, then re-add an expiry.
	if err := SetTTL(ctx, conn, "hash:1", -1); err != nil {
		t.Fatalf("SetTTL persist: %v", err)
	}
	if d, _ := GetKey(ctx, conn, "hash:1"); d.TTLSeconds != -1 {
		t.Errorf("after persist, ttl = %d, want -1", d.TTLSeconds)
	}

	// Rename + delete.
	if err := RenameKey(ctx, conn, "str:1", "str:renamed"); err != nil {
		t.Fatalf("RenameKey: %v", err)
	}
	if _, err := GetKey(ctx, conn, "str:1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("old key still present: %v", err)
	}
	if d, err := GetKey(ctx, conn, "str:renamed"); err != nil || d.String != "hello" {
		t.Errorf("renamed key = %+v, err %v", d, err)
	}
	if err := DeleteKey(ctx, conn, "str:renamed"); err != nil {
		t.Fatalf("DeleteKey: %v", err)
	}
	if _, err := GetKey(ctx, conn, "str:renamed"); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted key still present: %v", err)
	}

	// FlushDB empties everything.
	if err := FlushDB(ctx, conn); err != nil {
		t.Fatalf("FlushDB: %v", err)
	}
	page, _ = ScanKeys(ctx, conn, "*", "0", 100)
	if len(page.Keys) != 0 {
		t.Errorf("after flush, %d keys remain", len(page.Keys))
	}
}

func TestGetMissingKey(t *testing.T) {
	conn := liveRedis(t)
	if _, err := GetKey(context.Background(), conn, "nope"); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetKey(missing) = %v, want ErrNotFound", err)
	}
}

// TestTruncation guards the audit fix: a value larger than the caps must be
// bounded (so the root daemon never loads an unbounded structure) and reported as
// truncated with the real Length.
func TestTruncation(t *testing.T) {
	conn := liveRedis(t)
	ctx := context.Background()

	// A hash with more than maxElems fields.
	big := dial(conn)
	defer big.Close()
	pairs := make([]any, 0, (maxElems+50)*2)
	for i := 0; i < maxElems+50; i++ {
		pairs = append(pairs, fmt.Sprintf("f%05d", i), "v")
	}
	if err := big.HSet(ctx, "bighash", pairs...).Err(); err != nil {
		t.Fatalf("seed big hash: %v", err)
	}
	d, err := GetKey(ctx, conn, "bighash")
	if err != nil {
		t.Fatalf("GetKey bighash: %v", err)
	}
	if !d.Truncated {
		t.Error("big hash should be truncated")
	}
	if len(d.Fields) != maxElems {
		t.Errorf("returned %d fields, want the cap %d", len(d.Fields), maxElems)
	}
	if d.Length != int64(maxElems+50) {
		t.Errorf("Length = %d, want the real count %d", d.Length, maxElems+50)
	}

	// A string longer than maxStringBytes.
	if err := big.Set(ctx, "bigstr", strings.Repeat("x", maxStringBytes+1000), 0).Err(); err != nil {
		t.Fatalf("seed big string: %v", err)
	}
	s, err := GetKey(ctx, conn, "bigstr")
	if err != nil {
		t.Fatalf("GetKey bigstr: %v", err)
	}
	if !s.Truncated || len(s.String) != maxStringBytes {
		t.Errorf("big string: truncated=%v len=%d (want true, %d)", s.Truncated, len(s.String), maxStringBytes)
	}

	// A small key is not truncated.
	if err := SetKey(ctx, conn, SetRequest{Key: "small", Type: "string", String: "ok", TTLSeconds: -1}); err != nil {
		t.Fatalf("set small: %v", err)
	}
	if small, _ := GetKey(ctx, conn, "small"); small.Truncated {
		t.Error("small key should not be truncated")
	}
}

func TestParseInfo(t *testing.T) {
	// parseInfo is pure — exercise it without a container.
	raw := "# Server\r\nredis_version:7.4.0\r\nredis_mode:standalone\r\nuptime_in_seconds:42\r\n" +
		"# Clients\r\nconnected_clients:3\r\n# Memory\r\nused_memory:1048576\r\nused_memory_peak:2097152\r\nmaxmemory:268435456\r\n" +
		"# Stats\r\nkeyspace_hits:100\r\nkeyspace_misses:5\r\ntotal_commands_processed:999\r\n" +
		"# Keyspace\r\ndb0:keys=12,expires=3,avg_ttl=0\r\ndb1:keys=4,expires=0,avg_ttl=0\r\n"
	ov := parseInfo(raw)
	if ov.Version != "7.4.0" || ov.Mode != "standalone" || ov.UptimeSeconds != 42 {
		t.Errorf("server fields wrong: %+v", ov)
	}
	if ov.ConnectedClients != 3 || ov.UsedMemoryBytes != 1048576 || ov.MaxMemoryBytes != 268435456 {
		t.Errorf("mem/clients wrong: %+v", ov)
	}
	if ov.KeyspaceHits != 100 || ov.KeyspaceMisses != 5 || ov.TotalCommands != 999 {
		t.Errorf("stats wrong: %+v", ov)
	}
	if len(ov.Databases) != 2 || ov.Databases[0].Keys != 12 || ov.Databases[1].Keys != 4 {
		t.Errorf("keyspace wrong: %+v", ov.Databases)
	}
}
