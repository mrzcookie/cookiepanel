package system

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// dockerInstallURL is Docker's official cross-distro convenience installer. It
// detects the distro and wires up Docker's apt/dnf repo + the engine. We fetch
// it over https and run it with `sh` (an arg vector, never a shell string),
// rather than the `curl | sh` one-liner, so there's a real file on disk and no
// pipe — consistent with the daemon's no-shell-injection posture.
const dockerInstallURL = "https://get.docker.com"

// serviceUnitPath is where the systemd unit InstallService writes lives.
const serviceUnitPath = "/etc/systemd/system/" + serviceUnit

// EnsureDocker makes sure the Docker Engine is installed and running. It's a
// no-op when `docker` is already on PATH (it then just makes sure the engine is
// enabled, so `wings run` can reach it). Otherwise it runs Docker's official
// convenience installer.
//
// Returns ErrUnsupported when the host has no systemd (the macOS dev box lands
// here) — the caller is expected to warn and still bring the node online, since
// the daemon runs fine without Docker; it just can't host servers until one is
// present. Any other error means the installer itself failed.
func EnsureDocker(ctx context.Context) error {
	if _, err := exec.LookPath("docker"); err == nil {
		// Already installed — make sure the engine is up (best-effort; a missing
		// docker.service on an unusual setup shouldn't fail provisioning).
		_ = enableNow(ctx, "docker")
		return nil
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return ErrUnsupported
	}

	script, err := fetchInstaller(ctx, dockerInstallURL)
	if err != nil {
		return fmt.Errorf("fetch docker installer: %w", err)
	}
	defer func() { _ = os.Remove(script) }()

	// The installer pulls packages over the network and can take minutes, so it
	// gets its own generous timeout rather than the short `run` budget.
	ictx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	if out, err := exec.CommandContext(ictx, "sh", script).CombinedOutput(); err != nil {
		return fmt.Errorf("docker installer: %w: %s", err, tail(out, 5))
	}

	if err := enableNow(ctx, "docker"); err != nil {
		return fmt.Errorf("start docker: %w", err)
	}
	return nil
}

// ServiceConfig parameterizes the systemd unit InstallService writes.
type ServiceConfig struct {
	// ExecStart is the unit's ExecStart line, e.g. "/usr/local/bin/wings run".
	ExecStart string
}

// InstallService writes the daemon's systemd unit, reloads systemd, and enables
// + starts it. Idempotent: it overwrites any existing unit and re-enables, so
// re-running the installer is safe. The started service brings up `wings run`,
// which opens its own firewall ports on startup — so registering the service is
// all that's needed to get the node online. Requires systemd (ErrUnsupported
// otherwise).
func InstallService(ctx context.Context, cfg ServiceConfig) error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return ErrUnsupported
	}
	unit := fmt.Sprintf(`[Unit]
Description=Raptor Wings
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`, cfg.ExecStart)
	if err := os.WriteFile(serviceUnitPath, []byte(unit), 0o644); err != nil {
		return fmt.Errorf("write unit: %w", err)
	}
	if err := run(ctx, "systemctl", "daemon-reload"); err != nil {
		return err
	}
	return run(ctx, "systemctl", "enable", "--now", serviceUnit)
}

// enableNow enables + starts a systemd unit (idempotent).
func enableNow(ctx context.Context, unit string) error {
	if _, err := exec.LookPath("systemctl"); err != nil {
		return ErrUnsupported
	}
	return run(ctx, "systemctl", "enable", "--now", unit)
}

// fetchInstaller downloads an https installer script to a private temp file and
// returns its path; the caller runs and removes it. The body is capped — an
// installer script is tens of KB, so a multi-MB response is a misconfiguration.
func fetchInstaller(ctx context.Context, url string) (string, error) {
	if !strings.HasPrefix(url, "https://") {
		return "", fmt.Errorf("installer url must be https")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	f, err := os.CreateTemp("", "get-docker-*.sh")
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	if _, err := io.Copy(f, io.LimitReader(resp.Body, 1<<20)); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// tail returns the last n non-empty lines of out, trimmed — enough to surface a
// tool's failure without dumping its whole (verbose) log into an error.
func tail(out []byte, n int) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
