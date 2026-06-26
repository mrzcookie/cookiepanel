package filesystem

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	securejoin "github.com/cyphar/filepath-securejoin"
	"github.com/mholt/archives"
)

// maxArchiveEntries bounds how many members an extract will process — a cheap
// guard against a pathological archive. Real size enforcement is the (future)
// per-server disk quota.
const maxArchiveEntries = 200_000

// ErrUnsupportedArchive is returned for an archive format we can't create or read.
var ErrUnsupportedArchive = errors.New("unsupported archive format")

// archiverFor maps a panel-supplied format name onto a creator. Only formats Go
// can *write* are here; extraction (below) auto-detects a much broader set
// (7z/rar/gz/bz2/xz/zst/…), which those proprietary/streaming formats only
// support reading.
func archiverFor(format string) (archives.Archiver, error) {
	tar := archives.Tar{}
	switch strings.ToLower(strings.TrimPrefix(format, ".")) {
	case "zip":
		return archives.Zip{}, nil
	case "tar":
		return tar, nil
	case "tar.gz", "tgz":
		return archives.CompressedArchive{Archival: tar, Compression: archives.Gz{}}, nil
	case "tar.xz", "txz":
		return archives.CompressedArchive{Archival: tar, Compression: archives.Xz{}}, nil
	case "tar.bz2", "tbz2", "tbz":
		return archives.CompressedArchive{Archival: tar, Compression: archives.Bz2{}}, nil
	case "tar.zst", "tzst":
		return archives.CompressedArchive{Archival: tar, Compression: archives.Zstd{}}, nil
	default:
		return nil, fmt.Errorf("%w: %q", ErrUnsupportedArchive, format)
	}
}

// Archive packs sources into a new archive at dest in the given format. Each
// source is added under its basename (selecting /world + /a.txt yields world/… +
// a.txt). The write is atomic (tmp + rename); dest's parent must already exist.
func (m *Manager) Archive(
	ctx context.Context,
	serverID string,
	sources []string,
	dest, format string,
) error {
	arc, err := archiverFor(format)
	if err != nil {
		return err
	}
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	if len(sources) == 0 {
		return fmt.Errorf("no sources to archive")
	}
	destAbs, err := resolve(root, dest)
	if err != nil {
		return err
	}
	if destAbs == root {
		return fmt.Errorf("cannot write the archive to the server root")
	}
	if withinTrash(root, destAbs) {
		return ErrTraversal
	}
	dir := filepath.Dir(destAbs)
	if _, err := os.Stat(dir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("parent directory does not exist: %s", relPath(root, dir))
		}
		return err
	}

	fromDisk := make(map[string]string, len(sources))
	for _, s := range sources {
		abs, err := resolve(root, s)
		if err != nil {
			return err
		}
		if abs == root || withinTrash(root, abs) {
			return ErrTraversal
		}
		if _, err := os.Lstat(abs); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return ErrNotFound
			}
			return err
		}
		fromDisk[abs] = filepath.Base(abs)
	}
	files, err := archives.FilesFromDisk(ctx, nil, fromDisk)
	if err != nil {
		return fmt.Errorf("collect files: %w", err)
	}

	tmp, err := os.CreateTemp(dir, ".wings-arc-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpPath) }
	if err := arc.Archive(ctx, tmp, files); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("archive: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpPath, destAbs); err != nil {
		cleanup()
		return err
	}
	return nil
}

// Extract unpacks the archive at src into the dest directory (created if absent),
// auto-detecting the format from its content/extension (zip, tar(.gz/.bz2/.xz/
// .zst), 7z, rar, …). Every member is written under dest with a strict
// containment check (the zip-slip guard); symlinks and irregular members are
// skipped. Existing files are overwritten.
func (m *Manager) Extract(ctx context.Context, serverID, src, dest string) error {
	root, err := m.root(ctx, serverID)
	if err != nil {
		return err
	}
	srcAbs, err := resolve(root, src)
	if err != nil {
		return err
	}
	if withinTrash(root, srcAbs) {
		return ErrNotFound
	}
	destAbs, err := resolve(root, dest)
	if err != nil {
		return err
	}
	if withinTrash(root, destAbs) {
		return ErrTraversal
	}
	if err := os.MkdirAll(destAbs, 0o755); err != nil {
		return err
	}

	f, err := os.Open(srcAbs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	defer f.Close()

	format, input, err := archives.Identify(ctx, filepath.Base(srcAbs), f)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrUnsupportedArchive, relPath(root, srcAbs))
	}
	extractor, ok := format.(archives.Extractor)
	if !ok {
		return fmt.Errorf("%w: %s", ErrUnsupportedArchive, relPath(root, srcAbs))
	}

	count := 0
	return extractor.Extract(ctx, input, func(_ context.Context, info archives.FileInfo) error {
		count++
		if count > maxArchiveEntries {
			return fmt.Errorf("archive has too many entries")
		}
		// Zip-slip guard: the member name is untrusted; pin it under dest.
		target, err := safeJoin(destAbs, info.NameInArchive)
		if err != nil {
			return err
		}
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !info.Mode().IsRegular() {
			return nil // skip symlinks / devices / etc.
		}
		rc, err := info.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		return writeExtracted(target, rc)
	})
}

// safeJoin resolves an archive member name under destAbs. It first rejects any
// name that escapes lexically — absolute paths or `..` traversal — so a malicious
// archive fails loudly (the zip-slip / tar-slip guard), then resolves the result
// with SecureJoin so a symlink pre-planted in the destination subtree can't
// redirect a written member out of the volume.
func safeJoin(destAbs, name string) (string, error) {
	sep := string(filepath.Separator)
	cleaned := filepath.Clean(strings.TrimSpace(name))
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+sep) {
		return "", ErrTraversal
	}
	return securejoin.SecureJoin(destAbs, cleaned)
}

// writeExtracted creates target's parents and writes r into it, overwriting.
func writeExtracted(target string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, r); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
