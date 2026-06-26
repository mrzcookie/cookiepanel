package contract_test

// Conformance: every hand-written daemon wire type must produce JSON that the
// spec-generated type (in this same package) round-trips losslessly. If the
// daemon's structs and the OpenAPI spec drift apart, one of these fails — which
// is the whole point of the contract package. Lives in the daemon module so it
// runs in the normal `go test ./...`.

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/backup"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/contract"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/docker"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/drive"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/filesystem"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/firewall"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/mongobrowser"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/network"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/redisbrowser"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/server"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/sftp"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/sqlbrowser"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/store"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/system"
)

// assertConforms marshals a fully-populated daemon value, unmarshals it into the
// spec-generated type G, re-marshals, and compares the two as order-independent
// maps. Every field must be non-zero so the comparison actually exercises it.
func assertConforms[G any](t *testing.T, name string, daemonVal any) {
	t.Helper()
	raw, err := json.Marshal(daemonVal)
	if err != nil {
		t.Fatalf("%s: marshal daemon value: %v", name, err)
	}
	var gen G
	if err := json.Unmarshal(raw, &gen); err != nil {
		t.Fatalf("%s: spec type rejects the daemon's wire form: %v\n  %s", name, err, raw)
	}
	genRaw, err := json.Marshal(gen)
	if err != nil {
		t.Fatalf("%s: marshal generated value: %v", name, err)
	}
	var a, b map[string]any
	_ = json.Unmarshal(raw, &a)
	_ = json.Unmarshal(genRaw, &b)
	if !reflect.DeepEqual(a, b) {
		t.Errorf("%s: wire mismatch between daemon type and spec\n  daemon: %s\n  spec:   %s", name, raw, genRaw)
	}
}

func TestConformance(t *testing.T) {
	ts := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	used := uint64(512)

	// ── system ───────────────────────────────────────────────────────────────
	assertConforms[contract.HostInfo](t, "HostInfo", system.Info{
		Hostname: "box", OS: "linux", Platform: "ubuntu", PlatformVer: "24.04",
		Kernel: "6.8", Arch: "amd64", CPUModel: "Xeon", CPUCount: 8,
		MemTotal: 16 << 30, UptimeSecond: 1000,
	})
	assertConforms[contract.Stats](t, "Stats", system.Stats{
		CPUPct: 12.5, MemUsed: 1, MemTotal: 2, DiskUsed: 3, DiskTotal: 4,
		Load1: 0.1, Load5: 0.2, Load15: 0.3,
	})
	assertConforms[contract.DockerInfo](t, "DockerInfo", docker.Info{
		Available: true, ServerVersion: "27", Containers: 3, Running: 2, Images: 5, Error: "x",
	})
	assertConforms[contract.PruneResult](t, "PruneResult", docker.PruneResult{
		ImagesDeleted: 2, SpaceReclaimed: 1024,
	})

	// ── servers ──────────────────────────────────────────────────────────────
	assertConforms[contract.Server](t, "Server", server.Server{
		ServerID: "s1", Name: "mc", ContainerID: "c1", Image: "img",
		State: "running", Status: "Up", Error: "e",
	})
	assertConforms[contract.CreateServerRequest](t, "CreateServerRequest", server.CreateRequest{
		ServerID: "s1", Name: "mc", Image: "img", StartupCommand: "run",
		Env: map[string]string{"A": "B"}, NanoCPUs: 1e9, MemoryMB: 1024, DiskMB: 2048,
		StopSignal:  "SIGTERM",
		PortBinding: &server.PortBinding{HostIP: "0.0.0.0", HostPort: 25565, ContainerPort: 25565, Protocol: "tcp"},
		Install:     &server.InstallSpec{Image: "i", Entrypoint: "sh", Script: "echo", Env: map[string]string{"X": "Y"}},
		ConfigFiles: []server.ConfigFile{{File: "f", Parser: "properties", Replace: map[string]string{"K": "V"}}},
	})

	// ── networks ─────────────────────────────────────────────────────────────
	assertConforms[contract.Network](t, "Network", docker.Network{
		ID: "n1", NetworkID: "docker1", Name: "net", Driver: "bridge", Subnet: "10.0.0.0/24", Gateway: "10.0.0.1",
	})
	assertConforms[contract.CreateNetworkRequest](t, "CreateNetworkRequest", network.CreateRequest{
		NetworkID: "n1", Name: "net", Driver: "bridge", Subnet: "10.0.0.0/24", Gateway: "10.0.0.1",
	})
	assertConforms[contract.AttachRequest](t, "AttachRequest", network.AttachRequest{ServerID: "s1"})

	// ── firewall ─────────────────────────────────────────────────────────────
	assertConforms[contract.FirewallRule](t, "FirewallRule", firewall.Rule{Port: 25565, Protocol: "tcp"})
	assertConforms[contract.FirewallStatus](t, "FirewallStatus", firewall.Status{
		Backend: "ufw", Active: true, Rules: []firewall.Rule{{Port: 22, Protocol: "tcp"}},
	})

	// ── drives ───────────────────────────────────────────────────────────────
	assertConforms[contract.Drive](t, "Drive", drive.Drive{
		Device: "/dev/sdb", Model: "WD", SizeBytes: 1 << 40, UsedBytes: &used,
		Filesystem: "ext4", Mountpoint: "/data", IsDataTarget: true, System: false,
	})

	// ── files ────────────────────────────────────────────────────────────────
	assertConforms[contract.FileEntry](t, "FileEntry", filesystem.Entry{
		Name: "f.txt", Path: "/f.txt", Type: "file", Size: 10, Mode: "rw-r--r--", ModTime: ts,
	})
	assertConforms[contract.TrashEntry](t, "TrashEntry", filesystem.TrashEntry{
		ID: "t1", Name: "f.txt", OriginalPath: "/f.txt", Type: "file", Size: 10, DeletedAt: ts,
	})
	assertConforms[contract.DownloadJob](t, "DownloadJob", filesystem.Job{
		ID: "dl_1", ServerID: "s1", Path: "/f", URL: "https://x", Total: 100, Done: 50,
		State: filesystem.JobRunning, Error: "e", StartedAt: ts, UpdatedAt: ts,
	})

	// ── sftp (the handler embeds these + a port) ─────────────────────────────
	type sftpMint struct {
		sftp.Session
		Port int `json:"port"`
	}
	type sftpStatus struct {
		sftp.Info
		Port int `json:"port"`
	}
	assertConforms[contract.SftpMintResponse](t, "SftpMintResponse", sftpMint{
		Session: sftp.Session{Username: "u", Password: "p", ExpiresAt: ts}, Port: 2022,
	})
	assertConforms[contract.SftpStatusResponse](t, "SftpStatusResponse", sftpStatus{
		Info: sftp.Info{Active: true, Username: "u", ExpiresAt: ts}, Port: 2022,
	})

	// ── schedules ────────────────────────────────────────────────────────────
	assertConforms[contract.ScheduleStep](t, "ScheduleStep", store.ScheduleStep{
		Type: "command", Command: "say hi", Seconds: 5, Power: "start",
	})
	assertConforms[contract.Schedule](t, "Schedule", store.Schedule{
		ID: "sc1", ServerID: "s1", Name: "nightly", Cron: "0 0 * * *",
		Steps:   []store.ScheduleStep{{Type: "backup"}},
		Enabled: true, LastRunAt: ts, LastError: "e", LastStatus: "ok",
	})

	// ── backups ──────────────────────────────────────────────────────────────
	assertConforms[contract.Backup](t, "Backup", backup.Backup{
		Archive: "a1", ServerID: "s1", Name: "before", SizeBytes: 1024,
		Status: "completed", Error: "e", Locked: true, CreatedAt: ts,
	})

	// ── redis browser ─────────────────────────────────────────────────────────
	assertConforms[contract.RedisOverview](t, "RedisOverview", redisbrowser.Overview{
		Version: "7.4.0", Mode: "standalone", UptimeSeconds: 42, ConnectedClients: 3,
		UsedMemoryBytes: 1, PeakMemoryBytes: 2, MaxMemoryBytes: 3,
		KeyspaceHits: 100, KeyspaceMisses: 5, TotalCommands: 9,
		Databases: []redisbrowser.DBKeyspace{{DB: 0, Keys: 12, Expires: 3}},
	})
	assertConforms[contract.RedisKeyList](t, "RedisKeyList", redisbrowser.KeyList{
		Cursor: "0",
		Keys:   []redisbrowser.KeySummary{{Key: "k", Type: "string", TTLSeconds: -1, SizeBytes: 64, Length: 5}},
	})
	assertConforms[contract.RedisKeyDetail](t, "RedisKeyDetail", redisbrowser.KeyDetail{
		Key: "h", Type: "hash", TTLSeconds: 60, SizeBytes: 128,
		Fields: []redisbrowser.Field{{Field: "a", Value: "1"}},
	})
	assertConforms[contract.RedisKeyDetail](t, "RedisKeyDetail/zset", redisbrowser.KeyDetail{
		Key: "z", Type: "zset", TTLSeconds: -1,
		Members: []redisbrowser.ScoreMember{{Member: "m", Score: 1.5}},
	})
	assertConforms[contract.RedisKeyDetail](t, "RedisKeyDetail/string", redisbrowser.KeyDetail{
		Key: "s", Type: "string", TTLSeconds: -1, SizeBytes: 8, Length: 11,
		Truncated: true, String: "hello world",
	})
	assertConforms[contract.RedisKeyDetail](t, "RedisKeyDetail/list", redisbrowser.KeyDetail{
		Key: "l", Type: "list", TTLSeconds: -1, Length: 2, Items: []string{"a", "b"},
	})
	assertConforms[contract.RedisKeyDetail](t, "RedisKeyDetail/stream", redisbrowser.KeyDetail{
		Key: "x", Type: "stream", TTLSeconds: -1, Length: 1,
		Entries: []redisbrowser.StreamEntry{
			{ID: "1-0", Fields: []redisbrowser.Field{{Field: "a", Value: "1"}}},
		},
	})
	assertConforms[contract.RedisSetRequest](t, "RedisSetRequest", redisbrowser.SetRequest{
		Key: "k", Type: "string", TTLSeconds: -1, String: "v",
	})

	// ── mongo browser ──────────────────────────────────────────────────────────
	assertConforms[contract.MongoDatabase](t, "MongoDatabase", mongobrowser.Database{
		Name: "shop", SizeBytes: 4096,
	})
	assertConforms[contract.MongoCollection](t, "MongoCollection", mongobrowser.Collection{
		Name: "orders", Documents: 12, SizeBytes: 2048, Indexes: 1,
	})
	assertConforms[contract.MongoDocumentPage](t, "MongoDocumentPage", mongobrowser.DocumentPage{
		Total: 1, Documents: []mongobrowser.Document{{ID: "o1", JSON: `{"_id":"o1"}`}},
	})

	// ── sql browser ────────────────────────────────────────────────────────────
	colDefault := "now()"
	assertConforms[contract.SqlDatabase](t, "SqlDatabase", sqlbrowser.Database{
		Name: "shop", Charset: "utf8mb4", Tables: 3, SizeBytes: 8192,
	})
	assertConforms[contract.SqlTable](t, "SqlTable", sqlbrowser.Table{
		Name: "orders", Rows: 12, SizeBytes: 4096, Columns: 2,
	})
	assertConforms[contract.SqlColumn](t, "SqlColumn", sqlbrowser.Column{
		Name: "created_at", Type: "timestamp", Nullable: true, Key: "index", Default: &colDefault,
	})
	assertConforms[contract.SqlUser](t, "SqlUser", sqlbrowser.User{
		Name: "app_rw", Host: "%", Superuser: true, Grants: []string{"shop"},
	})
}
