// Package diskquota applies a best-effort hard size cap to a server's data
// directory via XFS project quotas. It only enforces on an XFS filesystem mounted
// with project quotas (prjquota/pquota) and the xfs_quota tool present; everywhere
// else it's a safe no-op, so it never blocks server creation. The daemon runs as
// root, which xfs_quota requires.
//
// Like the firewall + drive packages, it shells out with an arg vector (the dir
// is the daemon's own docker-volume mountpoint, never user text) and degrades
// gracefully where the tooling/filesystem isn't there — no build tags.
package diskquota

import (
	"context"
	"fmt"
	"hash/crc32"
	"os/exec"
	"strings"
	"time"
)

// Apply sets a hard block limit of `bytes` on `dir`. enforced is true only when a
// real quota was applied. A non-positive bytes, an empty dir, or a missing
// xfs_quota tool yields (false, nil) — not an error — so the caller's flow
// continues unchanged. A command failure (e.g. the FS isn't XFS/pquota) yields
// (false, err) for the caller to log, but is never treated as fatal.
func Apply(ctx context.Context, dir string, bytes int64) (enforced bool, err error) {
	if bytes <= 0 || dir == "" {
		return false, nil
	}
	if _, lookErr := exec.LookPath("xfs_quota"); lookErr != nil {
		return false, nil
	}
	projID := ProjectID(dir)
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// Assign the dir to a project, then cap that project's hard block usage. Each
	// is its own xfs_quota command expression (-c); the whole invocation is an arg
	// vector, never a shell string.
	for _, expr := range []string{
		fmt.Sprintf("project -s -p %s %d", dir, projID),
		fmt.Sprintf("limit -p bhard=%d %d", bytes, projID),
	} {
		cmd := exec.CommandContext(cctx, "xfs_quota", "-x", "-c", expr, dir)
		if out, runErr := cmd.CombinedOutput(); runErr != nil {
			return false, fmt.Errorf("xfs_quota %q: %w: %s", expr, runErr, strings.TrimSpace(string(out)))
		}
	}
	return true, nil
}

// ProjectID derives a deterministic XFS project id from the directory, so
// re-applying the same dir's quota is idempotent (the id doesn't churn across
// restarts). Bounded to [1000, 1000999] to stay clear of reserved low ids.
func ProjectID(dir string) uint32 {
	return crc32.ChecksumIEEE([]byte(dir))%1_000_000 + 1000
}
