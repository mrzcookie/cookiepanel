package server

import (
	"context"
	"fmt"
	"time"

	"github.com/cookiepanel/cookied/internal/docker"
)

// installLogLimit caps how much install output is echoed back in an error so a
// failing install gives the user something actionable without a giant payload.
const installLogLimit = 4000

// Safety envelope for the (untrusted) install container: enough headroom for
// real installs, but bounded so a runaway or hostile script can't fork-bomb or
// OOM the node. installHardTimeout is a daemon-side ceiling independent of the
// caller's request timeout.
const (
	installMemoryMB    = 2048
	installPidsLimit   = 1024
	installHardTimeout = 30 * time.Minute
	installMountPath   = "/mnt/server" // Pterodactyl's convention.
	// provisionTimeout bounds the whole background install→create→start (install
	// itself is capped by installHardTimeout; the rest is image pulls + create).
	provisionTimeout = 45 * time.Minute
)

// installCaps is the minimal capability set an install script plausibly needs:
// changing ownership/permissions of the files it lays down, dropping privileges
// to a runtime user, and managing the helper processes it spawns. Everything
// else (NET_RAW, MKNOD, SYS_CHROOT, AUDIT_WRITE, NET_BIND_SERVICE, …) is dropped
// via CapDrop ALL.
var installCaps = []string{
	"CHOWN", "DAC_OVERRIDE", "FOWNER", "FSETID",
	"SETGID", "SETUID", "SETFCAP", "KILL",
}

// runInstall executes an egg's install script once, in its own throwaway
// container, with the server's data volume mounted at /mnt/server. The script
// runs as `entrypoint -c <script>` under a memory/pids cap, no-new-privileges,
// and a dropped capability set. A non-zero exit is a failure carrying the tail
// of the script's output. The data volume must already exist.
func (m *Manager) runInstall(ctx context.Context, req CreateRequest) error {
	in := req.Install
	entrypoint := in.Entrypoint
	if entrypoint == "" {
		entrypoint = "bash"
	}
	image := in.Image
	if image == "" {
		// A template with a script but no install image is misconfigured; fall
		// back to the runtime image (it at least pulls and usually has a shell).
		image = req.Image
	}
	// Run from /mnt/server so relative paths in the script resolve like they do
	// under Pterodactyl (which sets the install working dir there).
	script := "cd " + installMountPath + " 2>/dev/null || true\n" + in.Script

	// Hard ceiling independent of the caller's request timeout, so a hung install
	// can't run forever even if the panel connection lingers.
	ictx, cancel := context.WithTimeout(ctx, installHardTimeout)
	defer cancel()

	res, err := m.docker.RunOnce(ictx, docker.RunSpec{
		Image:      image,
		Entrypoint: []string{entrypoint, "-c", script},
		Env:        in.Env,
		Mounts: []docker.RunMount{
			{Volume: DataVolumeName(req.ServerID), Path: installMountPath},
		},
		Labels:          map[string]string{docker.ServerIDLabel: req.ServerID},
		MemoryMB:        installMemoryMB,
		PidsLimit:       installPidsLimit,
		NoNewPrivileges: true,
		CapDrop:         []string{"ALL"},
		CapAdd:          installCaps,
	})
	if err != nil {
		return fmt.Errorf("install: %w", err)
	}
	if res.ExitCode != 0 {
		out := res.Output
		if len(out) > installLogLimit {
			out = out[len(out)-installLogLimit:]
		}
		return fmt.Errorf("install script exited %d:\n%s", res.ExitCode, out)
	}
	return nil
}
