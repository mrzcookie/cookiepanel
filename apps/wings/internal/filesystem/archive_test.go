package filesystem

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func mustWrite(t *testing.T, m *Manager, rel, content string) {
	t.Helper()
	if err := m.Write(context.Background(), testServer, rel, []byte(content)); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

// TestArchiveRoundTrip packs a file + a directory into each creatable format,
// extracts it back, and verifies the contents survive — across the popular
// container/compression combinations.
func TestArchiveRoundTrip(t *testing.T) {
	cases := []struct{ format, ext string }{
		{"zip", ".zip"},
		{"tar", ".tar"},
		{"tar.gz", ".tar.gz"},
		{"tar.xz", ".tar.xz"},
		{"tar.bz2", ".tar.bz2"},
		{"tar.zst", ".tar.zst"},
	}
	for _, tc := range cases {
		t.Run(tc.format, func(t *testing.T) {
			m, _ := newTestManager(t)
			ctx := context.Background()
			mustWrite(t, m, "/a.txt", "alpha")
			if err := m.Mkdir(ctx, testServer, "/d"); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			mustWrite(t, m, "/d/b.txt", "bravo")

			dest := "/out" + tc.ext
			if err := m.Archive(ctx, testServer, []string{"/a.txt", "/d"}, dest, tc.format); err != nil {
				t.Fatalf("archive: %v", err)
			}
			if err := m.Extract(ctx, testServer, dest, "/restored"); err != nil {
				t.Fatalf("extract: %v", err)
			}
			if got, err := m.Read(ctx, testServer, "/restored/a.txt"); err != nil || string(got) != "alpha" {
				t.Fatalf("restored a.txt = %q, err %v", got, err)
			}
			if got, err := m.Read(ctx, testServer, "/restored/d/b.txt"); err != nil || string(got) != "bravo" {
				t.Fatalf("restored d/b.txt = %q, err %v", got, err)
			}
		})
	}
}

func TestArchiveUnsupportedFormat(t *testing.T) {
	m, _ := newTestManager(t)
	mustWrite(t, m, "/a.txt", "x")
	// 7z / rar can't be *created* in Go (extract-only), so creation is rejected.
	for _, format := range []string{"7z", "rar", "bogus"} {
		err := m.Archive(context.Background(), testServer, []string{"/a.txt"}, "/o."+format, format)
		if !errors.Is(err, ErrUnsupportedArchive) {
			t.Fatalf("format %q: err = %v, want ErrUnsupportedArchive", format, err)
		}
	}
}

// TestSafeJoinRejectsTraversal is the zip-slip guard: malicious member names
// are rejected; benign nested names resolve under the extract dir.
func TestSafeJoinRejectsTraversal(t *testing.T) {
	dest := filepath.FromSlash("/vol/restored")
	for _, bad := range []string{
		"../escape",
		"../../etc/passwd",
		"a/../../escape",
		filepath.FromSlash("/etc/passwd"),
	} {
		if _, err := safeJoin(dest, bad); !errors.Is(err, ErrTraversal) {
			t.Fatalf("safeJoin(%q): err = %v, want ErrTraversal", bad, err)
		}
	}
	got, err := safeJoin(dest, "sub/file.txt")
	if err != nil {
		t.Fatalf("safeJoin benign: %v", err)
	}
	if want := filepath.Join(dest, "sub", "file.txt"); got != want {
		t.Fatalf("safeJoin = %q, want %q", got, want)
	}
}
