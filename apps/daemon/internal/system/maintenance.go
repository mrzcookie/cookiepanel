package system

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ErrUnsupported is returned by a maintenance op when the host lacks the tool it
// needs (e.g. no `systemctl` / `shutdown`). Mirrors firewall.ErrUnsupported so
// the API can map it to 501 rather than a 500. The daemon stays cross-platform:
// these shell out to host tools and degrade to ErrUnsupported where absent (the
// macOS dev box has no systemd), so nothing here needs a build tag.
var ErrUnsupported = errors.New("operation not supported on this host")

// serviceUnit is the systemd unit the installer registers the daemon under. The
// restart/self-update path drives the process through systemd so it comes back.
const serviceUnit = "cookied.service"

// sha256RE matches a lowercase hex SHA-256 digest.
var sha256RE = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Reboot reboots the host. `shutdown` schedules the reboot through init and
// returns promptly, so the caller's 202 flushes before the box goes down.
func Reboot(ctx context.Context) error {
	if _, err := exec.LookPath("shutdown"); err == nil {
		return run(ctx, "shutdown", "-r", "+0")
	}
	if _, err := exec.LookPath("systemctl"); err == nil {
		return run(ctx, "systemctl", "reboot")
	}
	return ErrUnsupported
}

// RestartDaemon restarts the daemon's own systemd unit. `--no-block` queues the
// job and returns immediately, so the HTTP response is sent before systemd stops
// this process and starts the replacement.
func RestartDaemon(ctx context.Context) error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return ErrUnsupported
	}
	return run(ctx, "systemctl", "--no-block", "restart", serviceUnit)
}

// UpdateDaemon downloads a new daemon binary, verifies it against the expected
// SHA-256, and atomically swaps it over the running executable. It does NOT
// restart — the caller triggers RestartDaemon after responding, so a failed
// download/verify surfaces as an error rather than a silent half-update. The
// integrity guarantee is the checksum (the panel supplies it from the release it
// chose), not transport, but the URL is still required to be https.
func UpdateDaemon(ctx context.Context, url, sha256Hex string) error {
	sha256Hex = strings.ToLower(strings.TrimSpace(sha256Hex))
	if !strings.HasPrefix(url, "https://") {
		return fmt.Errorf("update url must be https")
	}
	if !sha256RE.MatchString(sha256Hex) {
		return fmt.Errorf("invalid sha256 digest")
	}

	self, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	if resolved, rerr := filepath.EvalSymlinks(self); rerr == nil {
		self = resolved
	}

	// Stage the download beside the target so the final rename is same-filesystem
	// (atomic). A trailing temp file is cleaned up on any failure.
	dir := filepath.Dir(self)
	tmp, err := os.CreateTemp(dir, ".cookied-update-*")
	if err != nil {
		return fmt.Errorf("stage update: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		_ = tmp.Close()
		// Removing an already-renamed temp is a harmless no-op.
		_ = os.Remove(tmpName)
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download: unexpected status %d", resp.StatusCode)
	}

	sum := sha256.New()
	if _, err := io.Copy(tmp, io.TeeReader(resp.Body, sum)); err != nil {
		return fmt.Errorf("write update: %w", err)
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != sha256Hex {
		return fmt.Errorf("checksum mismatch: got %s, want %s", got, sha256Hex)
	}
	if err := tmp.Chmod(0o755); err != nil {
		return fmt.Errorf("chmod update: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("flush update: %w", err)
	}
	// Atomic replace of the running binary — Linux lets a busy executable's file
	// be renamed over; the new bytes take effect on the next start (RestartDaemon).
	if err := os.Rename(tmpName, self); err != nil {
		return fmt.Errorf("install update: %w", err)
	}
	return nil
}

// run executes a host tool with an arg vector (never a shell string) under a
// short timeout, surfacing the tool's stderr on failure.
func run(ctx context.Context, name string, args ...string) error {
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}
