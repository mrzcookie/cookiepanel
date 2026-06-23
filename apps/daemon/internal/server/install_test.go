package server

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/cookiepanel/cookied/internal/docker"
)

// installTestImage is small, present on most hosts, and has sh + coreutils. The
// install entrypoint is "sh" (alpine has no bash).
const installTestImage = "alpine:3"

func newDockerManager(t *testing.T) (*Manager, *docker.Client) {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Skipf("docker client: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if !c.Probe(ctx).Available {
		t.Skip("docker engine not reachable")
	}
	// Skip (not fail) when the test image can't be pulled — no network in CI.
	if err := c.PullImage(ctx, installTestImage); err != nil {
		t.Skipf("cannot pull %s: %v", installTestImage, err)
	}
	return NewManager(c), c
}

// waitState polls Get until the server leaves "installing" (or times out).
func waitState(t *testing.T, m *Manager, serverID string, timeout time.Duration) *Server {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		srv, err := m.Get(context.Background(), serverID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if srv != nil && srv.State != stateInstalling {
			return srv
		}
		if time.Now().After(deadline) {
			state := "<nil>"
			if srv != nil {
				state = srv.State
			}
			t.Fatalf("server stuck in %q after %s", state, timeout)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// TestInstallPipelineSuccess runs a real install: the install container writes a
// marker into the data volume, and the long-lived container only stays running
// if it sees that marker — so reaching "running" proves the install ran AND its
// output landed in the volume the runtime mounts.
func TestInstallPipelineSuccess(t *testing.T) {
	m, _ := newDockerManager(t)
	const serverID = "11111111-1111-4111-8111-111111111111"
	defer func() { _ = m.Delete(context.Background(), serverID) }()

	srv, err := m.Create(context.Background(), CreateRequest{
		ServerID: serverID,
		Name:     "install-ok",
		Image:    installTestImage,
		// Stay up only if the install marker is present in the data volume.
		StartupCommand: "test -f /data/installed && sleep 300",
		Install: &InstallSpec{
			Image:      installTestImage,
			Entrypoint: "sh",
			Script:     "echo installing...; touch /mnt/server/installed",
		},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if srv.State != stateInstalling {
		t.Fatalf("create returned state %q, want installing", srv.State)
	}
	// During install there's no container yet — List must still surface it.
	if list, _ := m.List(context.Background()); !containsState(list, serverID, stateInstalling) {
		t.Fatal("installing server missing from List")
	}

	final := waitState(t, m, serverID, 90*time.Second)
	if final.State != "running" {
		t.Fatalf("final state %q (err %q), want running", final.State, final.Error)
	}
}

// TestInstallPipelineFailure: a non-zero install script leaves the server in
// "failed" with the script's output, and no container is started.
func TestInstallPipelineFailure(t *testing.T) {
	m, _ := newDockerManager(t)
	const serverID = "22222222-2222-4222-8222-222222222222"
	defer func() { _ = m.Delete(context.Background(), serverID) }()

	if _, err := m.Create(context.Background(), CreateRequest{
		ServerID:       serverID,
		Name:           "install-fail",
		Image:          installTestImage,
		StartupCommand: "sleep 300",
		Install: &InstallSpec{
			Image:      installTestImage,
			Entrypoint: "sh",
			Script:     "echo boom-detail >&2; exit 7",
		},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	final := waitState(t, m, serverID, 90*time.Second)
	if final.State != stateFailed {
		t.Fatalf("final state %q, want failed", final.State)
	}
	if !strings.Contains(final.Error, "exited 7") {
		t.Fatalf("error %q, want it to mention exit 7", final.Error)
	}
	// No long-lived container should exist for a failed install.
	if c, _ := newRawClient(t).InspectByServerID(context.Background(), serverID); c != nil {
		t.Fatal("a container exists for a failed install")
	}
}

func containsState(list []Server, serverID, state string) bool {
	for _, s := range list {
		if s.ServerID == serverID && s.State == state {
			return true
		}
	}
	return false
}

func newRawClient(t *testing.T) *docker.Client {
	t.Helper()
	c, err := docker.New()
	if err != nil {
		t.Fatalf("docker client: %v", err)
	}
	return c
}
