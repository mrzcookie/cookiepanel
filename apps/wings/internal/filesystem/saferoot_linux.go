//go:build linux

package filesystem

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path"
	"strings"

	pathrs "github.com/cyphar/filepath-securejoin/pathrs-lite"
	"golang.org/x/sys/unix"
)

// This file is the Linux half of the volume sandbox: every op resolves its path
// with openat2(RESOLVE_IN_ROOT) — the kernel walks the whole path scoped to root
// in one atomic step, so no component can be swapped for a symlink between the
// check and the syscall (the TOCTOU window a SecureJoin'd *path* leaves). The
// write/rename ops below operate relative to an O_PATH handle to the *parent*
// directory (opened race-safely), which pins the real directory inode — a symlink
// swap of any path component afterwards can't redirect the create/rename. The
// non-Linux fallback (saferoot_other.go) keeps planted-symlink containment via
// SecureJoin but not the race-safety; the daemon ships on Linux.

// openInRoot opens rel for reading, race-safely contained within root. The handle
// is a normal readable file — the O_PATH result of OpenInRoot reopened O_RDONLY —
// so callers fstat it rather than Lstat'ing a re-resolvable path.
func openInRoot(root, rel string) (*os.File, error) {
	handle, err := pathrs.OpenInRoot(root, strings.TrimSpace(rel))
	if err != nil {
		return nil, err
	}
	defer handle.Close()
	return pathrs.Reopen(handle, os.O_RDONLY)
}

// mkdirAllInRoot creates rel (and missing parents) race-safely within root.
func mkdirAllInRoot(root, rel string, mode os.FileMode) error {
	return pathrs.MkdirAll(root, strings.TrimSpace(rel), mode)
}

// splitParent cleans a caller path and splits it into the parent directory
// (relative to root, for OpenInRoot) and the final base name, rejecting anything
// that resolves to the root itself.
func splitParent(rel string) (parent, base string, err error) {
	clean := path.Clean("/" + strings.TrimSpace(rel))
	if clean == "/" {
		return "", "", fmt.Errorf("path resolves to the root")
	}
	base = path.Base(clean)
	if base == "." || base == ".." || base == "/" || base == "" {
		return "", "", fmt.Errorf("invalid path %q", rel)
	}
	return path.Dir(clean), base, nil
}

func randSuffix() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// pendingWrite is an in-progress atomic write: a temp file created (via openat,
// O_EXCL|O_NOFOLLOW) inside rel's parent directory, which was opened race-safely
// so no symlink swap can redirect it. commit renames the temp over rel's base
// name within that same pinned directory.
type pendingWrite struct {
	File    *os.File // write target (the temp file)
	dir     *os.File // O_PATH handle to the parent dir — pins the inode, keep alive
	tmpName string
	base    string
}

func startWriteInRoot(root, rel string, mode os.FileMode) (*pendingWrite, error) {
	parent, base, err := splitParent(rel)
	if err != nil {
		return nil, err
	}
	dir, err := pathrs.OpenInRoot(root, parent)
	if err != nil {
		return nil, err // ENOENT when the parent is missing — the caller maps it
	}
	tmpName := ".wings-write-" + randSuffix()
	fd, err := unix.Openat(int(dir.Fd()), tmpName,
		unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW,
		uint32(mode.Perm()))
	if err != nil {
		_ = dir.Close()
		return nil, &os.PathError{Op: "openat", Path: tmpName, Err: err}
	}
	return &pendingWrite{
		File:    os.NewFile(uintptr(fd), tmpName),
		dir:     dir,
		tmpName: tmpName,
		base:    base,
	}, nil
}

func (p *pendingWrite) commit() error {
	if err := p.File.Close(); err != nil {
		p.abort()
		return err
	}
	dirFd := int(p.dir.Fd())
	// flags 0 → atomically replace any existing file at base.
	if err := unix.Renameat2(dirFd, p.tmpName, dirFd, p.base, 0); err != nil {
		_ = unix.Unlinkat(dirFd, p.tmpName, 0)
		_ = p.dir.Close()
		return &os.PathError{Op: "renameat", Path: p.base, Err: err}
	}
	return p.dir.Close()
}

func (p *pendingWrite) abort() {
	_ = p.File.Close()
	_ = unix.Unlinkat(int(p.dir.Fd()), p.tmpName, 0)
	_ = p.dir.Close()
}

// renameInRoot moves fromRel to toRel, each resolved relative to a race-safely
// opened parent-directory handle. With noReplace it fails (EEXIST) if the
// destination already exists, atomically.
func renameInRoot(root, fromRel, toRel string, noReplace bool) error {
	fromParent, fromBase, err := splitParent(fromRel)
	if err != nil {
		return err
	}
	toParent, toBase, err := splitParent(toRel)
	if err != nil {
		return err
	}
	fromDir, err := pathrs.OpenInRoot(root, fromParent)
	if err != nil {
		return err
	}
	defer fromDir.Close()
	toDir, err := pathrs.OpenInRoot(root, toParent)
	if err != nil {
		return err
	}
	defer toDir.Close()
	var flags uint
	if noReplace {
		flags = unix.RENAME_NOREPLACE
	}
	return unix.Renameat2(int(fromDir.Fd()), fromBase, int(toDir.Fd()), toBase, flags)
}
