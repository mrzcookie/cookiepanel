package backup

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/xena-studios/raptor/apps/wings/internal/docker"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
)

const seedImage = "alpine:3"

// liveManager spins up a Manager against the real engine, a temp store, and a
// freshly-seeded data volume for serverID. Skips when docker / image pulls are
// unavailable, and registers cleanup of every volume it creates.
func liveManager(t *testing.T, serverID string) (*Manager, *docker.Client) {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}
	for _, img := range []string{seedImage, defaultImg} {
		if err := c.PullImage(ctx, img); err != nil {
			t.Skipf("cannot pull %s: %v", img, err)
		}
	}

	vol := volumeFor(serverID)
	if err := c.CreateVolume(ctx, vol, serverID); err != nil {
		t.Fatalf("create volume: %v", err)
	}
	t.Cleanup(func() {
		_ = c.RemoveVolumesByServerID(context.Background(), serverID)
		_ = c.RemoveVolume(context.Background(), RepoVolume)
	})
	// Seed a marker file into the data volume.
	seed(t, c, vol, "echo marker-data > /data/marker.txt")

	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return NewManager(c, st), c
}

// seed runs a one-off alpine container with the volume mounted at /data.
func seed(t *testing.T, c *docker.Client, vol, script string) docker.RunResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	res, err := c.RunOnce(ctx, docker.RunSpec{
		Image:      seedImage,
		Entrypoint: []string{"sh"},
		Cmd:        []string{"-c", script},
		Mounts:     []docker.RunMount{{Volume: vol, Path: "/data"}},
	})
	if err != nil {
		t.Fatalf("seed run: %v", err)
	}
	return res
}

func TestBackupRoundTrip(t *testing.T) {
	const serverID = "11111111-1111-4111-8111-111111111111"
	m, c := liveManager(t, serverID)
	ctx := context.Background()

	// Create (synchronous path) + verify it lists as a completed backup.
	if err := m.RunBackup(ctx, serverID, "before update"); err != nil {
		t.Fatalf("RunBackup: %v", err)
	}
	list, err := m.List(ctx, serverID)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %+v, err %v", list, err)
	}
	b := list[0]
	if b.Status != StatusCompleted || b.Name != "before update" {
		t.Fatalf("backup = %+v", b)
	}
	if !strings.HasPrefix(b.Archive, borgID(serverID)+"-") {
		t.Fatalf("archive %q not prefixed by borg id", b.Archive)
	}

	// Mutate the volume, then restore — the marker must come back.
	seed(t, c, volumeFor(serverID), "rm -f /data/marker.txt")
	if err := m.Restore(ctx, serverID, b.Archive); err != nil {
		t.Fatalf("restore: %v", err)
	}
	out := seed(t, c, volumeFor(serverID), "cat /data/marker.txt")
	if !strings.Contains(out.Output, "marker-data") {
		t.Fatalf("restored content = %q, want marker-data", out.Output)
	}
}

func TestBackupCrossServerGuard(t *testing.T) {
	const serverID = "22222222-2222-4222-8222-222222222222"
	m, _ := liveManager(t, serverID)
	ctx := context.Background()

	if err := m.RunBackup(ctx, serverID, "x"); err != nil {
		t.Fatalf("RunBackup: %v", err)
	}
	list, _ := m.List(ctx, serverID)
	archive := list[0].Archive

	const other = "33333333-3333-4333-8333-333333333333"
	if err := m.Restore(ctx, other, archive); err == nil {
		t.Fatal("restore into another server: want error")
	}
	if err := m.Delete(ctx, other, archive); err == nil {
		t.Fatal("delete another server's archive: want error")
	}
}

func TestBackupLockBlocksDelete(t *testing.T) {
	const serverID = "44444444-4444-4444-8444-444444444444"
	m, _ := liveManager(t, serverID)
	ctx := context.Background()

	if err := m.RunBackup(ctx, serverID, "x"); err != nil {
		t.Fatalf("RunBackup: %v", err)
	}
	archive := mustList(t, m, serverID)[0].Archive

	if err := m.SetLock(serverID, archive, true); err != nil {
		t.Fatalf("lock: %v", err)
	}
	if err := m.Delete(ctx, serverID, archive); !errors.Is(err, ErrLocked) {
		t.Fatalf("delete locked: err = %v, want ErrLocked", err)
	}
	if !mustList(t, m, serverID)[0].Locked {
		t.Fatal("list does not report the backup as locked")
	}

	if err := m.SetLock(serverID, archive, false); err != nil {
		t.Fatalf("unlock: %v", err)
	}
	if err := m.Delete(ctx, serverID, archive); err != nil {
		t.Fatalf("delete after unlock: %v", err)
	}
	if len(mustList(t, m, serverID)) != 0 {
		t.Fatal("backup still present after delete")
	}
}

func mustList(t *testing.T, m *Manager, serverID string) []Backup {
	t.Helper()
	list, err := m.List(context.Background(), serverID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	return list
}
