package ipc

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/xena-studios/raptor/apps/wings/internal/server"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
)

func newTestServer(t *testing.T, sock string) (*Server, *store.Store) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(Config{
		SocketPath: sock,
		Store:      st,
		Servers:    server.NewManager(nil),
	}), st
}

func TestRoundTrip(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "wings.sock")
	srv, st := newTestServer(t, sock)
	if err := st.PutStatus(store.Status{NodeID: "n1", DaemonVersion: "9.9.9"}); err != nil {
		t.Fatalf("seed status: %v", err)
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer srv.Shutdown(context.Background())

	// The socket must be root-only (owner read/write).
	info, err := os.Stat(sock)
	if err != nil {
		t.Fatalf("stat socket: %v", err)
	}
	if perm := info.Mode().Perm(); perm != socketPerm {
		t.Errorf("socket perms = %o, want %o", perm, socketPerm)
	}

	c := NewClient(sock)
	ctx := context.Background()
	if err := c.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	got, err := c.Status(ctx)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if got.NodeID != "n1" || got.DaemonVersion != "9.9.9" {
		t.Errorf("status = %+v, want NodeID=n1 version=9.9.9", got)
	}

	// Shutdown removes the socket file.
	_ = srv.Shutdown(ctx)
	if _, err := os.Stat(sock); !os.IsNotExist(err) {
		t.Errorf("socket still present after shutdown: %v", err)
	}
}

func TestStaleSocketReclaimed(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "wings.sock")
	// Leave a stale socket file behind (nothing listening on it).
	laddr, _ := net.ResolveUnixAddr("unix", sock)
	ln, err := net.ListenUnix("unix", laddr)
	if err != nil {
		t.Fatalf("seed stale socket: %v", err)
	}
	ln.SetUnlinkOnClose(false)
	_ = ln.Close()
	if _, err := os.Stat(sock); err != nil {
		t.Fatalf("setup: expected a leftover socket: %v", err)
	}

	srv, _ := newTestServer(t, sock)
	if err := srv.Start(); err != nil {
		t.Fatalf("start over stale socket: %v", err)
	}
	defer srv.Shutdown(context.Background())
	if err := NewClient(sock).Ping(context.Background()); err != nil {
		t.Fatalf("ping after reclaim: %v", err)
	}
}

func TestRefusesLiveSocket(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "wings.sock")
	s1, _ := newTestServer(t, sock)
	if err := s1.Start(); err != nil {
		t.Fatalf("start first: %v", err)
	}
	defer s1.Shutdown(context.Background())

	s2, _ := newTestServer(t, sock)
	if err := s2.Start(); err == nil {
		_ = s2.Shutdown(context.Background())
		t.Fatal("expected an error binding over a live socket, got nil")
	}
}
