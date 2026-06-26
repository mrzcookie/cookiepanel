package sftp

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// fakeInspector roots every server's volume at a fixed temp dir (no docker).
type fakeInspector struct{ root string }

func (f fakeInspector) VolumeMountpoint(_ context.Context, _ string) (string, error) {
	return f.root, nil
}

func newServer(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	m, err := NewManager(fakeInspector{root: root}, t.TempDir())
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	if err := m.Serve("127.0.0.1:0"); err != nil {
		t.Fatalf("serve: %v", err)
	}
	t.Cleanup(m.Shutdown)
	return m, root
}

func dial(t *testing.T, addr, user, pass string) (*sftp.Client, func()) {
	t.Helper()
	conn, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.Password(pass)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	})
	if err != nil {
		t.Fatalf("ssh dial: %v", err)
	}
	sc, err := sftp.NewClient(conn)
	if err != nil {
		_ = conn.Close()
		t.Fatalf("sftp client: %v", err)
	}
	return sc, func() { _ = sc.Close(); _ = conn.Close() }
}

func TestSFTPRoundTrip(t *testing.T) {
	m, root := newServer(t)
	addr := m.listener.Addr().String()

	sess, err := m.Mint("server-1")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	sc, closeFn := dial(t, addr, sess.Username, sess.Password)
	defer closeFn()

	// write
	f, err := sc.Create("/hello.txt")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := f.Write([]byte("hi there")); err != nil {
		t.Fatalf("write: %v", err)
	}
	_ = f.Close()

	// the bytes really landed in the server's data volume
	if got, _ := os.ReadFile(filepath.Join(root, "hello.txt")); string(got) != "hi there" {
		t.Fatalf("on-disk content = %q", got)
	}

	// read back
	rf, err := sc.Open("/hello.txt")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	got, _ := io.ReadAll(rf)
	_ = rf.Close()
	if string(got) != "hi there" {
		t.Fatalf("read = %q, want %q", got, "hi there")
	}

	// mkdir + rename + list
	if err := sc.Mkdir("/d"); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := sc.Rename("/hello.txt", "/d/hello.txt"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	infos, err := sc.ReadDir("/d")
	if err != nil || len(infos) != 1 || infos[0].Name() != "hello.txt" {
		t.Fatalf("readdir = %+v, err %v", infos, err)
	}

	// remove
	if err := sc.Remove("/d/hello.txt"); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "d", "hello.txt")); !os.IsNotExist(err) {
		t.Fatal("file still present after remove")
	}
}

func TestSFTPAuthFailure(t *testing.T) {
	m, _ := newServer(t)
	addr := m.listener.Addr().String()
	sess, _ := m.Mint("server-1")

	// wrong password
	if _, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            sess.Username,
		Auth:            []ssh.AuthMethod{ssh.Password("not-the-password")},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}); err == nil {
		t.Fatal("wrong password: expected auth failure")
	}

	// revoked session
	m.Revoke("server-1")
	if _, err := ssh.Dial("tcp", addr, &ssh.ClientConfig{
		User:            sess.Username,
		Auth:            []ssh.AuthMethod{ssh.Password(sess.Password)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         5 * time.Second,
	}); err == nil {
		t.Fatal("revoked session: expected auth failure")
	}
}

func TestSFTPActiveAndRevoke(t *testing.T) {
	m, _ := newServer(t)
	if info := m.Active("s1"); info.Active {
		t.Fatal("no session yet, want inactive")
	}
	sess, _ := m.Mint("s1")
	info := m.Active("s1")
	if !info.Active || info.Username != sess.Username {
		t.Fatalf("active = %+v after mint", info)
	}
	m.Revoke("s1")
	if m.Active("s1").Active {
		t.Fatal("still active after revoke")
	}
}

// TestHandlerSandbox is the path guard: traversal never escapes the volume root.
func TestHandlerSandbox(t *testing.T) {
	h := &rootedHandler{root: filepath.FromSlash("/vol")}
	for _, p := range []string{
		"/world/level.dat",
		"/../../etc/passwd",
		"/a/../../../../etc/shadow",
		"sub/../other",
	} {
		abs, err := h.resolve(p)
		if err != nil {
			t.Fatalf("resolve(%q): %v", p, err)
		}
		rel, _ := filepath.Rel(h.root, abs)
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			t.Fatalf("resolve(%q) = %q escaped root", p, abs)
		}
	}
}
