// Package filesystem is the sandboxed per-server file manager: list, read,
// write, mkdir, rename, and delete, with strict path-traversal protection
// rooted at each server's data volume.
//
// Each server's data lives in a docker named volume "cookied-srv-<id>" (created
// by the server manager at create time, mounted at /data inside the container).
// The daemon runs as root and reads/writes those bytes via the volume's host
// mountpoint, which it resolves once per request via the docker client.
package filesystem

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	securejoin "github.com/cyphar/filepath-securejoin"
)

// VolumePrefix matches the per-server volume name created by the server manager;
// see internal/server (DataVolumeName). It MUST stay in sync with that prefix.
const VolumePrefix = "cookied-srv-"

// trashDirName is the hidden directory at the volume root that holds deleted
// files (the recycle bin). Each deleted item lives in its own subdirectory:
//
//	.cookie-trash/<id>/payload    the file or directory that was deleted
//	.cookie-trash/<id>/meta.json  its original path, name, and deletion time
//
// User-facing file ops (List/Read/Write/...) treat this directory as if it
// doesn't exist; only the Trash* methods reach inside it.
const trashDirName = ".cookie-trash"

const (
	trashPayload  = "payload"
	trashMetaFile = "meta.json"
)

// MaxReadBytes caps how much of a single file we'll return through Read. The
// file manager is for text/config files; anything bigger is almost certainly a
// log or binary and should be downloaded over the streaming endpoint instead.
// The cap doubles as a defense against accidentally serving a multi-GB log into
// the panel.
const MaxReadBytes = 2 * 1024 * 1024 // 2 MiB

// Inspector is the docker-client surface the manager needs. Kept narrow so the
// package can be tested with a fake.
type Inspector interface {
	VolumeMountpoint(ctx context.Context, name string) (string, error)
}

// Manager exposes file operations scoped to a single server's data volume.
// All paths supplied by callers are relative to that volume's root; they are
// cleaned and verified to stay inside it before any os call runs.
type Manager struct {
	docker Inspector
	jobs   *Jobs
}

// New constructs a Manager. The Inspector may be nil; in that case every
// operation returns ErrDockerUnavailable so the daemon can still boot when
// docker is missing (the panel will surface the failure on use).
func New(d Inspector) *Manager {
	return &Manager{docker: d, jobs: NewJobs()}
}

// Jobs returns the URL-download job registry. Used by HTTP handlers to start a
// pull and poll its status.
func (m *Manager) Jobs() *Jobs { return m.jobs }

// Entry is one item in a directory listing.
type Entry struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"` // relative to the server root, leading "/"
	Type    string    `json:"type"` // "file" | "dir" | "symlink"
	Size    int64     `json:"size"`
	Mode    string    `json:"mode"` // rwxr-xr-x style
	ModTime time.Time `json:"modTime"`
}

// ErrDockerUnavailable signals the docker client isn't initialized; surface a
// clear panel-level error instead of dereferencing nil.
var ErrDockerUnavailable = errors.New("docker unavailable on this node")

// ErrTraversal is returned when a caller-supplied path escapes the server root.
var ErrTraversal = errors.New("path escapes server root")

// ErrTooLarge is returned by Read when the target file exceeds MaxReadBytes.
var ErrTooLarge = errors.New("file too large to read inline")

// ErrNotFound mirrors os.ErrNotExist with a stable, panel-friendly message.
var ErrNotFound = errors.New("path not found")

func (m *Manager) root(ctx context.Context, serverID string) (string, error) {
	if m == nil || m.docker == nil {
		return "", ErrDockerUnavailable
	}
	mp, err := m.docker.VolumeMountpoint(ctx, VolumePrefix+serverID)
	if err != nil {
		return "", err
	}
	return mp, nil
}

// resolve turns a caller-supplied path into an absolute path guaranteed to stay
// within root, following symlinks **scoped beneath root**, so a symlink planted
// inside the volume (by the server's own container process or an install script)
// can't redirect an op to the host filesystem. A lexical clean+join is not
// enough: os.Open/ReadDir/etc. follow symlinks in intermediate path components,
// and the daemon reads the volume via its *host* mountpoint as root, so an
// absolute symlink target would otherwise resolve against the host. SecureJoin
// (the primitive runc/Docker use) resolves every component within root.
//
// SecureJoin returns a *path*, so a TOCTOU window remains — an attacker who swaps
// a component for a symlink between this call and the os.* call could still
// escape. The content **read** paths (Read, Open) and Mkdir close that window on
// Linux by going through openInRoot/mkdirAllInRoot (openat2 RESOLVE_IN_ROOT — the
// kernel resolves atomically; see saferoot_linux.go). resolve is still used for
// the containment guards (trash/root checks, error display) and for the write +
// rename paths, where openat2's atomic-create/rename primitives aren't wrapped
// yet — those keep the planted-symlink containment, with the residual race.
func resolve(root, rel string) (string, error) {
	return securejoin.SecureJoin(root, strings.TrimSpace(rel))
}

// relPath maps an absolute path under root back to the "/"-prefixed
// caller-facing form used in API responses.
func relPath(root, abs string) string {
	r, err := filepath.Rel(root, abs)
	if err != nil || r == "." {
		return "/"
	}
	return "/" + filepath.ToSlash(r)
}

// trashRoot is the absolute path of the recycle bin for a server root.
func trashRoot(root string) string { return filepath.Join(root, trashDirName) }

// withinTrash reports whether abs is the recycle bin or anything inside it.
// User-facing operations use this to keep the bin invisible and untouchable
// through the normal file browser.
func withinTrash(root, abs string) bool {
	tr := trashRoot(root)
	return abs == tr || strings.HasPrefix(abs, tr+string(filepath.Separator))
}

// validTrashID guards an id coming from the API: it must be a single path
// segment so it can't escape the bin directory.
func validTrashID(id string) bool {
	return id != "" && !strings.ContainsAny(id, "/\\") && id != "." && id != ".."
}

// newTrashID returns a sortable, collision-resistant id (nanosecond timestamp
// plus random suffix) used as the bin subdirectory name.
func newTrashID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%d-%s", time.Now().UTC().UnixNano(), hex.EncodeToString(b[:]))
}

func entryKind(info os.FileInfo) string {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return "symlink"
	case info.IsDir():
		return "dir"
	default:
		return "file"
	}
}

// List returns the entries directly under rel. Symlinks are reported as such,
// never followed (a symlink pointing outside the root would otherwise leak
// access). Entries sort directories first, then by name.
func (m *Manager) List(ctx context.Context, serverID, rel string) ([]Entry, error) {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return nil, err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return nil, err
	}
	// The recycle bin is not part of the browsable tree.
	if withinTrash(root, abs) {
		return nil, ErrNotFound
	}
	info, err := os.Lstat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", relPath(root, abs))
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(dirents))
	for _, de := range dirents {
		// Hide the recycle bin directory from the root listing.
		if abs == root && de.Name() == trashDirName {
			continue
		}
		fi, err := de.Info()
		if err != nil {
			// Race (entry vanished between ReadDir and Stat) — skip rather than
			// fail the whole listing.
			continue
		}
		out = append(out, Entry{
			Name:    de.Name(),
			Path:    relPath(root, filepath.Join(abs, de.Name())),
			Type:    entryKind(fi),
			Size:    fi.Size(),
			Mode:    fi.Mode().Perm().String(),
			ModTime: fi.ModTime().UTC(),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Type == "dir") != (out[j].Type == "dir") {
			return out[i].Type == "dir"
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Read returns the contents of a regular file, capped at MaxReadBytes. Larger
// files return ErrTooLarge so the panel can offer a download link instead.
func (m *Manager) Read(ctx context.Context, serverID, rel string) ([]byte, error) {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return nil, err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return nil, err
	}
	// The trash guard is containment-only (don't expose the recycle bin through
	// the browser), so a re-resolvable path is fine here; the *content* open below
	// is the race-safe one.
	if withinTrash(root, abs) {
		return nil, ErrNotFound
	}
	f, err := openInRoot(root, rel)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	defer f.Close()
	// fstat the opened handle (not Lstat of a path) so the size/dir checks can't be
	// raced against a symlink swap after resolution.
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("is a directory: %s", relPath(root, abs))
	}
	if info.Size() > MaxReadBytes {
		return nil, ErrTooLarge
	}
	// LimitReader as a belt-and-suspenders guard in case the file grew between
	// the size check and the read.
	return io.ReadAll(io.LimitReader(f, MaxReadBytes+1))
}

// Write replaces (or creates) the file at rel with content. The write is atomic
// per-file: write to a sibling tmp then rename. Parent directory must exist.
func (m *Manager) Write(ctx context.Context, serverID, rel string, content []byte) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("cannot write to the server root")
	}
	if withinTrash(root, abs) {
		return ErrTraversal
	}
	dir := filepath.Dir(abs)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("parent directory does not exist: %s", relPath(root, dir))
		}
		return err
	}
	tmp, err := os.CreateTemp(dir, ".cookied-write-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, abs); err != nil {
		cleanup()
		return err
	}
	return nil
}

// Mkdir creates a directory at rel, including any missing parents.
func (m *Manager) Mkdir(ctx context.Context, serverID, rel string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("server root already exists")
	}
	if withinTrash(root, abs) {
		return ErrTraversal
	}
	return mkdirAllInRoot(root, rel, 0o755)
}

// Rename moves the entry at from to to. Both must resolve inside the server
// root, and the destination must not already exist.
func (m *Manager) Rename(ctx context.Context, serverID, from, to string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	src, err := resolve(root, from)
	if err != nil {
		return err
	}
	dst, err := resolve(root, to)
	if err != nil {
		return err
	}
	if src == root || dst == root {
		return fmt.Errorf("cannot rename the server root")
	}
	if withinTrash(root, src) || withinTrash(root, dst) {
		return ErrTraversal
	}
	if _, err := os.Lstat(dst); err == nil {
		return fmt.Errorf("destination exists: %s", relPath(root, dst))
	}
	return os.Rename(src, dst)
}

// Open returns a read-only file handle plus its FileInfo, suitable for streaming
// a download response. Caller must Close the file. Symlinks and directories are
// rejected (consistent with Read).
func (m *Manager) Open(ctx context.Context, serverID, rel string) (*os.File, os.FileInfo, error) {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return nil, nil, err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return nil, nil, err
	}
	if withinTrash(root, abs) {
		return nil, nil, ErrNotFound
	}
	f, err := openInRoot(root, rel)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, nil, err
	}
	if info.IsDir() {
		_ = f.Close()
		return nil, nil, fmt.Errorf("is a directory: %s", relPath(root, abs))
	}
	return f, info, nil
}

// WriteStream replaces (or creates) the file at rel with bytes from r. Like
// Write the write is atomic per-file (tmp + rename). Used by upload and URL
// download endpoints where streaming avoids buffering the whole file.
func (m *Manager) WriteStream(ctx context.Context, serverID, rel string, r io.Reader) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("cannot write to the server root")
	}
	if withinTrash(root, abs) {
		return ErrTraversal
	}
	dir := filepath.Dir(abs)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("parent directory does not exist: %s", relPath(root, dir))
		}
		return err
	}
	tmp, err := os.CreateTemp(dir, ".cookied-write-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }
	if _, err := io.Copy(tmp, r); err != nil {
		_ = tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, abs); err != nil {
		cleanup()
		return err
	}
	return nil
}

// WriteStreamFromURL fetches url, streams the response into rel as an atomic
// write, and reports progress through onProgress (called periodically with the
// running byte count). It is meant to be called from a background goroutine
// owned by the Jobs registry. Cancellation flows through ctx.
func (m *Manager) WriteStreamFromURL(
	ctx context.Context, serverID, rel, url string,
	onTotal func(total int64), onProgress func(done int64),
) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("cannot write to the server root")
	}
	if withinTrash(root, abs) {
		return ErrTraversal
	}
	dir := filepath.Dir(abs)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("parent directory does not exist: %s", relPath(root, dir))
		}
		return err
	}
	// Pull the URL. The HTTP client is local so a slow upstream doesn't tie up
	// the daemon's default transport. Ctx propagates so the panel can cancel by
	// killing the job.
	req, err := newURLDownloadRequest(ctx, url)
	if err != nil {
		return err
	}
	resp, err := urlDownloadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("upstream %s: HTTP %d", url, resp.StatusCode)
	}
	onTotal(resp.ContentLength) // -1 if upstream didn't set Content-Length

	tmp, err := os.CreateTemp(dir, ".cookied-dl-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }

	if _, err := copyWithProgress(ctx, tmp, resp.Body, onProgress); err != nil {
		_ = tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, abs); err != nil {
		cleanup()
		return err
	}
	return nil
}

// Delete removes the file or directory at rel. Directories are removed
// recursively. The server root itself is protected.
func (m *Manager) Delete(ctx context.Context, serverID, rel string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("cannot delete the server root")
	}
	if err := os.RemoveAll(abs); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// ─── Recycle bin ─────────────────────────────────────────────────────────────

// TrashEntry is one item in the recycle bin, as reported to the panel.
type TrashEntry struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	OriginalPath string    `json:"originalPath"`
	Type         string    `json:"type"` // "file" | "dir" | "symlink"
	Size         int64     `json:"size"`
	DeletedAt    time.Time `json:"deletedAt"`
}

// trashMeta is the on-disk sidecar stored next to each trashed payload.
type trashMeta struct {
	Name         string    `json:"name"`
	OriginalPath string    `json:"originalPath"`
	Type         string    `json:"type"`
	Size         int64     `json:"size"`
	DeletedAt    time.Time `json:"deletedAt"`
}

// Trash moves the entry at rel into the recycle bin instead of deleting it
// outright. The original path and deletion time are recorded so the item can be
// restored or auto-purged later. Same protections as Delete: the server root
// can't be trashed, and items already in the bin are off-limits.
func (m *Manager) Trash(ctx context.Context, serverID, rel string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if abs == root {
		return fmt.Errorf("cannot delete the server root")
	}
	if withinTrash(root, abs) {
		return ErrTraversal
	}
	info, err := os.Lstat(abs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}

	id := newTrashID()
	dest := filepath.Join(trashRoot(root), id)
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	// Move the payload first; if anything below fails, tear the entry down so we
	// never leave a half-written bin record.
	if err := os.Rename(abs, filepath.Join(dest, trashPayload)); err != nil {
		_ = os.RemoveAll(dest)
		return err
	}
	var size int64
	if !info.IsDir() {
		size = info.Size()
	}
	meta := trashMeta{
		Name:         info.Name(),
		OriginalPath: relPath(root, abs),
		Type:         entryKind(info),
		Size:         size,
		DeletedAt:    time.Now().UTC(),
	}
	blob, err := json.Marshal(meta)
	if err != nil {
		_ = os.RemoveAll(dest)
		return err
	}
	if err := os.WriteFile(filepath.Join(dest, trashMetaFile), blob, 0o644); err != nil {
		_ = os.RemoveAll(dest)
		return err
	}
	return nil
}

// readTrashMeta loads the sidecar for one bin entry, falling back to the
// directory's mtime for DeletedAt when the sidecar is missing or unreadable (so
// a corrupt entry is still listable and purgeable, never stuck).
func readTrashMeta(entryDir, id string) (trashMeta, error) {
	blob, err := os.ReadFile(filepath.Join(entryDir, trashMetaFile))
	if err == nil {
		var meta trashMeta
		if jsonErr := json.Unmarshal(blob, &meta); jsonErr == nil {
			return meta, nil
		}
	}
	meta := trashMeta{Name: id, OriginalPath: "/", Type: "file"}
	if fi, statErr := os.Stat(filepath.Join(entryDir, trashPayload)); statErr == nil {
		meta.DeletedAt = fi.ModTime().UTC()
		meta.Type = entryKind(fi)
		if !fi.IsDir() {
			meta.Size = fi.Size()
		}
	}
	return meta, nil
}

// ListTrash returns the recycle bin's contents, newest deletion first. An absent
// bin is not an error; it lists as empty.
func (m *Manager) ListTrash(ctx context.Context, serverID string) ([]TrashEntry, error) {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(trashRoot(root))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []TrashEntry{}, nil
		}
		return nil, err
	}
	out := make([]TrashEntry, 0, len(dirents))
	for _, de := range dirents {
		if !de.IsDir() {
			continue
		}
		id := de.Name()
		meta, _ := readTrashMeta(filepath.Join(trashRoot(root), id), id)
		out = append(out, TrashEntry{
			ID:           id,
			Name:         meta.Name,
			OriginalPath: meta.OriginalPath,
			Type:         meta.Type,
			Size:         meta.Size,
			DeletedAt:    meta.DeletedAt,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].DeletedAt.After(out[j].DeletedAt)
	})
	return out, nil
}

// RestoreTrash moves a binned item back to its original path. If something
// already occupies that path, a " (restored)" suffix is added (numbered if
// needed) so a restore never clobbers a live file. Missing parent directories
// are recreated.
func (m *Manager) RestoreTrash(ctx context.Context, serverID, id string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	if !validTrashID(id) {
		return ErrTraversal
	}
	entryDir := filepath.Join(trashRoot(root), id)
	payload := filepath.Join(entryDir, trashPayload)
	if _, err := os.Lstat(payload); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	meta, _ := readTrashMeta(entryDir, id)
	dst, err := resolve(root, meta.OriginalPath)
	if err != nil || dst == root || withinTrash(root, dst) {
		// Corrupt/unsafe original path: fall back to restoring by name at root.
		dst = filepath.Join(root, filepath.Base(meta.Name))
	}
	dst = nonConflicting(dst)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(payload, dst); err != nil {
		return err
	}
	return os.RemoveAll(entryDir)
}

// nonConflicting returns abs if nothing exists there, otherwise the path with a
// " (restored)" / " (restored N)" suffix inserted before the extension.
func nonConflicting(abs string) string {
	if _, err := os.Lstat(abs); errors.Is(err, os.ErrNotExist) {
		return abs
	}
	ext := filepath.Ext(abs)
	base := strings.TrimSuffix(abs, ext)
	for i := 1; i < 1000; i++ {
		suffix := " (restored)"
		if i > 1 {
			suffix = fmt.Sprintf(" (restored %d)", i)
		}
		candidate := base + suffix + ext
		if _, err := os.Lstat(candidate); errors.Is(err, os.ErrNotExist) {
			return candidate
		}
	}
	return base + fmt.Sprintf(" (restored %d)", time.Now().UTC().UnixNano()) + ext
}

// DeleteTrash permanently removes a single bin entry.
func (m *Manager) DeleteTrash(ctx context.Context, serverID, id string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	if !validTrashID(id) {
		return ErrTraversal
	}
	if err := os.RemoveAll(filepath.Join(trashRoot(root), id)); err != nil {
		return err
	}
	return nil
}

// EmptyTrash permanently removes everything in the recycle bin.
func (m *Manager) EmptyTrash(ctx context.Context, serverID string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(trashRoot(root)); err != nil {
		return err
	}
	return nil
}

// PurgeTrashOlderThan permanently removes bin entries deleted more than maxAge
// ago and returns how many it removed. A non-positive maxAge purges nothing
// (auto-purge disabled). Used by the panel's scheduled purge job.
func (m *Manager) PurgeTrashOlderThan(ctx context.Context, serverID string, maxAge time.Duration) (int, error) {
	if maxAge <= 0 {
		return 0, nil
	}
	root, err := m.root(ctx, serverID)
	if err != nil {
		return 0, err
	}
	dirents, err := os.ReadDir(trashRoot(root))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	cutoff := time.Now().UTC().Add(-maxAge)
	purged := 0
	for _, de := range dirents {
		if !de.IsDir() {
			continue
		}
		id := de.Name()
		meta, _ := readTrashMeta(filepath.Join(trashRoot(root), id), id)
		if meta.DeletedAt.Before(cutoff) {
			if err := os.RemoveAll(filepath.Join(trashRoot(root), id)); err == nil {
				purged++
			}
		}
	}
	return purged, nil
}
