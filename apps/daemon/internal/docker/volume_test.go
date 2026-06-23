package docker

import (
	"context"
	"testing"
	"time"
)

// TestVolumeLifecycle exercises the per-server volume helpers against the real
// engine: create → inspect mountpoint → remove-by-server-id. Skips when docker
// isn't reachable so it's safe in CI without a daemon.
func TestVolumeLifecycle(t *testing.T) {
	c, err := New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	defer c.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}

	const serverID = "test-vol-server"
	name := "cookied-srv-" + serverID
	// Clean up whatever this test creates, even on failure.
	defer func() { _ = c.RemoveVolumesByServerID(context.Background(), serverID) }()

	if err := c.CreateVolume(ctx, name, serverID); err != nil {
		t.Fatalf("create volume: %v", err)
	}
	// Idempotent: a second create on the same name is a no-op, not an error.
	if err := c.CreateVolume(ctx, name, serverID); err != nil {
		t.Fatalf("create volume (idempotent): %v", err)
	}

	mp, err := c.VolumeMountpoint(ctx, name)
	if err != nil {
		t.Fatalf("mountpoint: %v", err)
	}
	if mp == "" {
		t.Fatal("mountpoint is empty")
	}

	if err := c.RemoveVolumesByServerID(ctx, serverID); err != nil {
		t.Fatalf("remove by server id: %v", err)
	}
	// After removal the volume is gone, so inspect fails.
	if _, err := c.VolumeMountpoint(ctx, name); err == nil {
		t.Fatal("mountpoint after remove: want error, got nil")
	}
	// Removing again is a no-op (no matching volumes).
	if err := c.RemoveVolumesByServerID(ctx, serverID); err != nil {
		t.Fatalf("remove (idempotent): %v", err)
	}
}
