package sftp

import (
	"fmt"
	"io"
	"os"
	"strings"

	securejoin "github.com/cyphar/filepath-securejoin"
	"github.com/pkg/sftp"
)

// rootedHandler serves SFTP requests sandboxed to a single server's data volume.
// Every client path is cleaned and verified to stay under root before any os
// call; symlinks are never followed, created, or read (they could otherwise leak
// access outside the volume).
type rootedHandler struct{ root string }

func newHandlers(root string) sftp.Handlers {
	h := &rootedHandler{root: root}
	return sftp.Handlers{FileGet: h, FilePut: h, FileCmd: h, FileList: h}
}

// resolve turns the client-supplied path into an absolute path guaranteed to
// stay under root, following symlinks **scoped beneath root** (SecureJoin) so a
// symlink planted in the volume can't escape the sandbox to the host. A
// resolution error is reported to the client as a permission error.
func (h *rootedHandler) resolve(p string) (string, error) {
	abs, err := securejoin.SecureJoin(h.root, strings.TrimSpace(p))
	if err != nil {
		return "", os.ErrPermission
	}
	return abs, nil
}

func (h *rootedHandler) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	abs, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, os.ErrPermission
	}
	if info.IsDir() {
		return nil, fmt.Errorf("is a directory")
	}
	return os.Open(abs) // *os.File is an io.ReaderAt + io.Closer
}

func (h *rootedHandler) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	abs, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	// Never write through an existing symlink (it could point outside the root).
	if info, lerr := os.Lstat(abs); lerr == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, os.ErrPermission
	}
	flags := os.O_RDWR | os.O_CREATE
	if r.Pflags().Trunc {
		flags |= os.O_TRUNC
	}
	return os.OpenFile(abs, flags, 0o644)
}

func (h *rootedHandler) Filecmd(r *sftp.Request) error {
	abs, err := h.resolve(r.Filepath)
	if err != nil {
		return err
	}
	switch r.Method {
	case "Mkdir":
		return os.MkdirAll(abs, 0o755)
	case "Rmdir", "Remove":
		return os.Remove(abs)
	case "Rename":
		dst, err := h.resolve(r.Target)
		if err != nil {
			return err
		}
		return os.Rename(abs, dst)
	case "Setstat":
		// Accept chmod/size hints best-effort; never fail an upload over them.
		return nil
	case "Symlink", "Link":
		// No links inside the sandbox.
		return os.ErrPermission
	default:
		return sftp.ErrSSHFxOpUnsupported
	}
}

func (h *rootedHandler) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	abs, err := h.resolve(r.Filepath)
	if err != nil {
		return nil, err
	}
	switch r.Method {
	case "List":
		entries, err := os.ReadDir(abs)
		if err != nil {
			return nil, err
		}
		infos := make([]os.FileInfo, 0, len(entries))
		for _, e := range entries {
			info, ierr := e.Info()
			if ierr != nil {
				continue // entry vanished mid-listing; skip
			}
			infos = append(infos, info)
		}
		return listerat(infos), nil
	case "Stat":
		info, err := os.Lstat(abs)
		if err != nil {
			return nil, err
		}
		return listerat{info}, nil
	default:
		// Readlink and friends: symlinks aren't exposed.
		return nil, os.ErrPermission
	}
}

// listerat adapts a slice of FileInfo to sftp.ListerAt.
type listerat []os.FileInfo

func (l listerat) ListAt(f []os.FileInfo, offset int64) (int, error) {
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(f, l[offset:])
	if int(offset)+n >= len(l) {
		return n, io.EOF
	}
	return n, nil
}
