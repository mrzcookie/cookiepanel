package filesystem

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// fakeInspector returns a fixed mountpoint for every volume name, so the manager
// can be exercised against a plain temp directory (no docker needed).
type fakeInspector struct{ root string }

func (f fakeInspector) VolumeMountpoint(_ context.Context, _ string) (string, error) {
	return f.root, nil
}

const testServer = "srv-1"

func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	return New(fakeInspector{root: root}), root
}

func TestWriteReadList(t *testing.T) {
	m, _ := newTestManager(t)
	ctx := context.Background()

	if err := m.Write(ctx, testServer, "/server.properties", []byte("motd=hi")); err != nil {
		t.Fatalf("write: %v", err)
	}
	// Writing under a missing parent fails until the dir exists.
	if err := m.Write(ctx, testServer, "/world/level.dat", []byte("x")); err == nil {
		t.Fatal("write into missing dir: want error, got nil")
	}
	if err := m.Mkdir(ctx, testServer, "/world"); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := m.Write(ctx, testServer, "/world/level.dat", []byte("data")); err != nil {
		t.Fatalf("write nested: %v", err)
	}

	got, err := m.Read(ctx, testServer, "/server.properties")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != "motd=hi" {
		t.Fatalf("read content = %q, want %q", got, "motd=hi")
	}

	entries, err := m.List(ctx, testServer, "/")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// Directories sort first: world/, then server.properties.
	if len(entries) != 2 || entries[0].Name != "world" || entries[0].Type != "dir" {
		t.Fatalf("list = %+v, want [world(dir), server.properties]", entries)
	}
	if entries[1].Name != "server.properties" || entries[1].Type != "file" {
		t.Fatalf("second entry = %+v", entries[1])
	}
}

func TestTraversalIsSandboxed(t *testing.T) {
	m, root := newTestManager(t)
	ctx := context.Background()

	// A "../" path must never escape the root: it writes inside root, not above.
	if err := m.Write(ctx, testServer, "/../escape.txt", []byte("nope")); err != nil {
		t.Fatalf("write traversal: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "escape.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("traversal escaped the root — file written above root")
	}
	if _, err := os.Stat(filepath.Join(root, "escape.txt")); err != nil {
		t.Fatalf("traversal not contained under root: %v", err)
	}

	// Reading an absolute host path resolves under root → not found (never /etc).
	if _, err := m.Read(ctx, testServer, "/../../../../etc/hosts"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read host path: err = %v, want ErrNotFound", err)
	}
}

func TestReadTooLarge(t *testing.T) {
	m, root := newTestManager(t)
	ctx := context.Background()
	big := make([]byte, MaxReadBytes+1)
	if err := os.WriteFile(filepath.Join(root, "big.bin"), big, 0o644); err != nil {
		t.Fatalf("seed big file: %v", err)
	}
	if _, err := m.Read(ctx, testServer, "/big.bin"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("read big: err = %v, want ErrTooLarge", err)
	}
}

func TestSymlinkNotFollowed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privilege on windows")
	}
	m, root := newTestManager(t)
	ctx := context.Background()
	// A symlink pointing outside the root must be listed as a symlink and never
	// read through (it would otherwise leak host files).
	if err := os.Symlink("/etc/hosts", filepath.Join(root, "link")); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	entries, err := m.List(ctx, testServer, "/")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(entries) != 1 || entries[0].Type != "symlink" {
		t.Fatalf("list = %+v, want one symlink", entries)
	}
	if _, err := m.Read(ctx, testServer, "/link"); err == nil {
		t.Fatal("read symlink: want error, got nil")
	}
}

// TestIntermediateSymlinkContained is the regression test for the symlink
// sandbox escape: a symlink *directory* planted in the volume (as the server's
// own container process or an install script can) must not let a read or write
// follow it out to the host filesystem. (The leaf-symlink case is covered by
// TestSymlinkNotFollowed; this covers an intermediate component.)
func TestIntermediateSymlinkContained(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privilege on windows")
	}
	m, root := newTestManager(t)
	ctx := context.Background()

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("TOPSECRET"), 0o600); err != nil {
		t.Fatalf("seed secret: %v", err)
	}
	// Plant `<root>/escape` → an absolute path outside the volume.
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	// Reading through the intermediate symlink must not reach the host file.
	if got, err := m.Read(ctx, testServer, "/escape/secret"); err == nil && string(got) == "TOPSECRET" {
		t.Fatal("read escaped the sandbox via an intermediate symlink")
	}
	// Writing through it must not land outside the volume.
	_ = m.Write(ctx, testServer, "/escape/planted", []byte("x"))
	if _, err := os.Stat(filepath.Join(outside, "planted")); err == nil {
		t.Fatal("write escaped the sandbox via an intermediate symlink")
	}
}

func TestRename(t *testing.T) {
	m, _ := newTestManager(t)
	ctx := context.Background()
	_ = m.Write(ctx, testServer, "/old.txt", []byte("v"))
	if err := m.Rename(ctx, testServer, "/old.txt", "/new.txt"); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, err := m.Read(ctx, testServer, "/old.txt"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("old still present: %v", err)
	}
	if got, _ := m.Read(ctx, testServer, "/new.txt"); string(got) != "v" {
		t.Fatalf("renamed content = %q", got)
	}
	// Renaming onto an existing path is refused.
	_ = m.Write(ctx, testServer, "/taken.txt", []byte("x"))
	if err := m.Rename(ctx, testServer, "/new.txt", "/taken.txt"); err == nil {
		t.Fatal("rename onto existing: want error, got nil")
	}
}

func TestTrashRoundTrip(t *testing.T) {
	m, _ := newTestManager(t)
	ctx := context.Background()
	_ = m.Write(ctx, testServer, "/doomed.txt", []byte("bye"))

	if err := m.Trash(ctx, testServer, "/doomed.txt"); err != nil {
		t.Fatalf("trash: %v", err)
	}
	// Trashed file vanishes from the browsable listing, and the bin itself is hidden.
	entries, _ := m.List(ctx, testServer, "/")
	for _, e := range entries {
		if e.Name == "doomed.txt" || e.Name == trashDirName {
			t.Fatalf("listing leaks %q after trash", e.Name)
		}
	}
	bin, err := m.ListTrash(ctx, testServer)
	if err != nil || len(bin) != 1 || bin[0].OriginalPath != "/doomed.txt" {
		t.Fatalf("ListTrash = %+v, err = %v", bin, err)
	}

	if err := m.RestoreTrash(ctx, testServer, bin[0].ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if got, err := m.Read(ctx, testServer, "/doomed.txt"); err != nil || string(got) != "bye" {
		t.Fatalf("restored content = %q, err = %v", got, err)
	}
	if bin, _ := m.ListTrash(ctx, testServer); len(bin) != 0 {
		t.Fatalf("bin not empty after restore: %+v", bin)
	}
}

func TestURLDownloadJob(t *testing.T) {
	// The httptest server listens on loopback, which the SSRF guard blocks in
	// production; relax it for this test (restored after).
	prev := dialGuard
	dialGuard = func(_, _ string, _ syscall.RawConn) error { return nil }
	defer func() { dialGuard = prev }()

	m, _ := newTestManager(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("downloaded-bytes"))
	}))
	defer srv.Close()

	id, err := m.Jobs().Start(m, testServer, "/pulled.bin", srv.URL)
	if err != nil {
		t.Fatalf("start job: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		job, ok := m.Jobs().Get(id)
		if !ok {
			t.Fatal("job vanished")
		}
		if job.State == JobDone {
			break
		}
		if job.State == JobError || job.State == JobCancelled {
			t.Fatalf("job ended in %s: %s", job.State, job.Error)
		}
		if time.Now().After(deadline) {
			t.Fatalf("job did not finish; last state %s", job.State)
		}
		time.Sleep(20 * time.Millisecond)
	}

	got, err := m.Read(context.Background(), testServer, "/pulled.bin")
	if err != nil || string(got) != "downloaded-bytes" {
		t.Fatalf("downloaded content = %q, err = %v", got, err)
	}
}

func TestURLDownloadRejectsBadScheme(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Jobs().Start(m, testServer, "/x", "file:///etc/passwd"); err == nil {
		t.Fatal("file:// scheme: want rejection, got nil")
	}
	if _, err := m.Jobs().Start(m, testServer, "/x", "ftp://example.com/x"); err == nil {
		t.Fatal("ftp:// scheme: want rejection, got nil")
	}
}

func TestDockerUnavailable(t *testing.T) {
	m := New(nil)
	if _, err := m.List(context.Background(), testServer, "/"); !errors.Is(err, ErrDockerUnavailable) {
		t.Fatalf("nil inspector: err = %v, want ErrDockerUnavailable", err)
	}
}

// Guard against a future edit accidentally changing the volume name the panel +
// server manager agree on.
func TestVolumePrefixStable(t *testing.T) {
	if !strings.HasPrefix(VolumePrefix+"abc", "wings-srv-") {
		t.Fatalf("VolumePrefix = %q, want wings-srv-", VolumePrefix)
	}
}
