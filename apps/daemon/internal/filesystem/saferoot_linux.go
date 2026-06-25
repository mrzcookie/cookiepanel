//go:build linux

package filesystem

import (
	"os"
	"strings"

	pathrs "github.com/cyphar/filepath-securejoin/pathrs-lite"
)

// openInRoot opens rel for reading, race-safely contained within root via
// openat2(RESOLVE_IN_ROOT): the kernel resolves the whole path scoped to root in
// one atomic operation, so no component can be swapped for a symlink between the
// check and the open (the TOCTOU window SecureJoin leaves). The returned handle
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
