//go:build !linux

package filesystem

import (
	"os"
	"path/filepath"
)

// Non-Linux fallback (the macOS dev box): openat2 isn't available, so fall back to
// SecureJoin + the plain os call. This keeps containment against *planted*
// symlinks (SecureJoin resolves every component scoped to root); only the openat2
// race-safety is Linux-only. The daemon ships on Linux, so production gets the
// stronger guarantee — this half just keeps `go build`/tests green off-Linux.

func openInRoot(root, rel string) (*os.File, error) {
	abs, err := resolve(root, rel)
	if err != nil {
		return nil, err
	}
	return os.Open(abs)
}

func mkdirAllInRoot(root, rel string, mode os.FileMode) error {
	abs, err := resolve(root, rel)
	if err != nil {
		return err
	}
	return os.MkdirAll(abs, mode)
}

// pendingWrite mirrors the Linux atomic-write handle with SecureJoin'd paths.
type pendingWrite struct {
	File      *os.File
	tmpPath   string
	finalPath string
}

func startWriteInRoot(root, rel string, mode os.FileMode) (*pendingWrite, error) {
	abs, err := resolve(root, rel)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(abs)
	if _, err := os.Stat(dir); err != nil {
		return nil, err // ENOENT propagated; the caller maps it
	}
	f, err := os.CreateTemp(dir, ".wings-write-*")
	if err != nil {
		return nil, err
	}
	if mode != 0 {
		_ = f.Chmod(mode.Perm())
	}
	return &pendingWrite{File: f, tmpPath: f.Name(), finalPath: abs}, nil
}

func (p *pendingWrite) commit() error {
	if err := p.File.Close(); err != nil {
		_ = os.Remove(p.tmpPath)
		return err
	}
	if err := os.Rename(p.tmpPath, p.finalPath); err != nil {
		_ = os.Remove(p.tmpPath)
		return err
	}
	return nil
}

func (p *pendingWrite) abort() {
	_ = p.File.Close()
	_ = os.Remove(p.tmpPath)
}

func renameInRoot(root, fromRel, toRel string, noReplace bool) error {
	src, err := resolve(root, fromRel)
	if err != nil {
		return err
	}
	dst, err := resolve(root, toRel)
	if err != nil {
		return err
	}
	if noReplace {
		if _, err := os.Lstat(dst); err == nil {
			return os.ErrExist
		}
	}
	return os.Rename(src, dst)
}
