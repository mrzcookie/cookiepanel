//go:build !linux

package filesystem

import "os"

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
