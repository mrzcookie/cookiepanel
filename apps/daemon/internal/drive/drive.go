// Package drive manages the host's physical disks for the panel's Storage tab:
// enumerate drives, format/mount/unmount a dedicated data disk, and point
// Docker's data-root at one so server data lands there. The daemon runs as root,
// so every request is validated up front — device paths and mountpoints are
// allow-listed and the OS/system drive can never be formatted, unmounted, or
// repurposed (a guard enforced here, not just in the UI).
//
// Like the firewall package, this shells out to host tools (lsblk, mkfs, mount,
// blkid, systemctl) with arg vectors — never a shell string — and degrades to
// ErrUnsupported where a tool is absent (so it compiles and the daemon runs on
// the macOS dev box, just without working drive ops). No build tags: the pure
// logic (lsblk parsing, system detection, validation) is unit-tested anywhere;
// the privileged calls only do real work on a Linux host.
//
// One device == one whole-disk filesystem: format writes the filesystem directly
// to the disk (no partition table), which is the "attach a blank data disk" flow
// the UI drives. A disk whose data lives in partitions is reported at the disk
// level only (its partitions' filesystems aren't surfaced), but if any partition
// is mounted at a system path the whole disk is flagged System and locked.
package drive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/cookiepanel/cookied/internal/store"
	"github.com/shirou/gopsutil/v4/disk"
)

// Sentinel errors the API maps onto HTTP status codes.
var (
	ErrUnsupported = errors.New("drive operations are not supported on this host")
	ErrNotFound    = errors.New("no such drive")
	ErrSystemDrive = errors.New("refusing to modify the system drive")
	ErrDataTarget  = errors.New("refusing to unmount the server-data drive")
	ErrInvalid     = errors.New("invalid drive request")
)

// dockerConfigPath is the engine config the data-root relocation rewrites.
const dockerConfigPath = "/etc/docker/daemon.json"

// systemMounts are paths a managed drive must never be torn out from under.
var systemMounts = map[string]bool{
	"/": true, "/boot": true, "/boot/efi": true,
	"/usr": true, "/var": true, "/etc": true,
}

// allowedFS are the filesystems the panel can create.
var allowedFS = map[string][]string{
	"ext4":  {"mkfs.ext4", "-F"},
	"xfs":   {"mkfs.xfs", "-f"},
	"btrfs": {"mkfs.btrfs", "-f"},
}

// deviceRE allow-lists a bare block-device path: /dev/<name> with no further
// slashes, dots, or dashes — so no traversal and no /dev/disk/by-id indirection.
var deviceRE = regexp.MustCompile(`^/dev/[a-zA-Z0-9]+$`)

// Drive is a physical disk as the panel renders it.
type Drive struct {
	Device       string  `json:"device"`
	Model        string  `json:"model"`
	SizeBytes    uint64  `json:"sizeBytes"`
	UsedBytes    *uint64 `json:"usedBytes"`  // null when unmounted
	Filesystem   string  `json:"filesystem"` // "" when unformatted
	Mountpoint   string  `json:"mountpoint"` // "" when unmounted
	IsDataTarget bool    `json:"isDataTarget"`
	System       bool    `json:"system"` // mounted at / or another system path
}

// Manager performs drive operations against the host.
type Manager struct {
	store *store.Store
}

// NewManager constructs a drive Manager.
func NewManager(st *store.Store) *Manager { return &Manager{store: st} }

// List enumerates the host's disks via lsblk, merges in the chosen data target,
// and (for mounted disks) their usage.
func (m *Manager) List(ctx context.Context) ([]Drive, error) {
	devices, err := m.lsblk(ctx)
	if err != nil {
		return nil, err
	}
	target, _ := m.store.GetDataTarget()

	drives := make([]Drive, 0, len(devices))
	for _, d := range devices {
		if d.Type != "disk" {
			continue
		}
		dr := toDrive(d, target)
		if dr.Mountpoint != "" {
			if usage, uerr := disk.UsageWithContext(ctx, dr.Mountpoint); uerr == nil {
				used := usage.Used
				dr.UsedBytes = &used
			}
		}
		drives = append(drives, dr)
	}
	return drives, nil
}

// Format writes a fresh filesystem to the whole device, then mounts it. Erases
// the disk — the system drive is refused.
func (m *Manager) Format(ctx context.Context, device, fs, mountpoint string) error {
	if err := validFilesystem(fs); err != nil {
		return err
	}
	if err := validMountpoint(mountpoint); err != nil {
		return err
	}
	if _, err := m.guard(ctx, device); err != nil {
		return err
	}
	mkfs := allowedFS[fs]
	if _, err := exec.LookPath(mkfs[0]); err != nil {
		return ErrUnsupported
	}
	args := append(append([]string{}, mkfs[1:]...), device)
	if err := run(ctx, 2*time.Minute, mkfs[0], args...); err != nil {
		return fmt.Errorf("format %s: %w", device, err)
	}
	return m.mount(ctx, device, mountpoint, fs)
}

// Mount mounts an already-formatted device at mountpoint.
func (m *Manager) Mount(ctx context.Context, device, mountpoint string) error {
	if err := validMountpoint(mountpoint); err != nil {
		return err
	}
	dr, err := m.guard(ctx, device)
	if err != nil {
		return err
	}
	return m.mount(ctx, device, mountpoint, dr.Filesystem)
}

// Unmount unmounts a device. The system drive and the active server-data drive
// are refused (the latter would pull the rug from under Docker).
func (m *Manager) Unmount(ctx context.Context, device string) error {
	dr, err := m.guard(ctx, device)
	if err != nil {
		return err
	}
	if dr.IsDataTarget {
		return ErrDataTarget
	}
	if _, err := exec.LookPath("umount"); err != nil {
		return ErrUnsupported
	}
	if err := run(ctx, 30*time.Second, "umount", device); err != nil {
		return fmt.Errorf("unmount %s: %w", device, err)
	}
	removeFstab(device, dr.Mountpoint)
	return nil
}

// SetDataTarget points Docker's data-root at a mounted drive and restarts the
// engine so server data lands there. Disruptive — running containers blip while
// Docker restarts — so it's an explicit operator action.
func (m *Manager) SetDataTarget(ctx context.Context, device string) error {
	dr, err := m.guard(ctx, device)
	if err != nil {
		return err
	}
	if dr.Mountpoint == "" {
		return fmt.Errorf("%w: drive must be mounted first", ErrInvalid)
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return ErrUnsupported
	}
	if err := setDockerDataRoot(dr.Mountpoint); err != nil {
		return fmt.Errorf("set docker data-root: %w", err)
	}
	if err := run(ctx, 60*time.Second, "systemctl", "restart", "docker"); err != nil {
		return fmt.Errorf("restart docker: %w", err)
	}
	if err := m.store.PutDataTarget(device); err != nil {
		return fmt.Errorf("record data target: %w", err)
	}
	return nil
}

// guard loads a drive fresh and refuses if it's missing or the system drive.
func (m *Manager) guard(ctx context.Context, device string) (Drive, error) {
	if !deviceRE.MatchString(device) {
		return Drive{}, fmt.Errorf("%w: bad device path", ErrInvalid)
	}
	drives, err := m.List(ctx)
	if err != nil {
		return Drive{}, err
	}
	for _, dr := range drives {
		if dr.Device == device {
			if dr.System {
				return Drive{}, ErrSystemDrive
			}
			return dr, nil
		}
	}
	return Drive{}, ErrNotFound
}

// mount creates the mountpoint, mounts the device, and persists an fstab entry so
// the mount survives a reboot (fstab persistence is best-effort).
func (m *Manager) mount(ctx context.Context, device, mountpoint, fs string) error {
	if _, err := exec.LookPath("mount"); err != nil {
		return ErrUnsupported
	}
	if err := os.MkdirAll(mountpoint, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", mountpoint, err)
	}
	if err := run(ctx, 30*time.Second, "mount", device, mountpoint); err != nil {
		return fmt.Errorf("mount %s: %w", device, err)
	}
	persistFstab(ctx, device, mountpoint, fs)
	return nil
}

// ─── enumeration (pure-ish: parsing is testable) ─────────────────────────────

func (m *Manager) lsblk(ctx context.Context) ([]lsblkDevice, error) {
	if _, err := exec.LookPath("lsblk"); err != nil {
		return nil, ErrUnsupported
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(cctx, "lsblk",
		"--json", "--bytes",
		"--output", "NAME,PATH,MODEL,SIZE,FSTYPE,MOUNTPOINT,TYPE",
	).Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk: %w", err)
	}
	return parseLsblk(out)
}

type lsblkDevice struct {
	Name        string        `json:"name"`
	Path        string        `json:"path"`
	Model       string        `json:"model"`
	Size        flexUint64    `json:"size"`
	FSType      string        `json:"fstype"`
	Mountpoint  string        `json:"mountpoint"`
	Mountpoints []*string     `json:"mountpoints"`
	Type        string        `json:"type"`
	Children    []lsblkDevice `json:"children"`
}

// parseLsblk decodes `lsblk --json` output into its block devices.
func parseLsblk(out []byte) ([]lsblkDevice, error) {
	var parsed struct {
		BlockDevices []lsblkDevice `json:"blockdevices"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("parse lsblk: %w", err)
	}
	return parsed.BlockDevices, nil
}

// toDrive projects a disk-level lsblk node onto a Drive.
func toDrive(d lsblkDevice, dataTarget string) Drive {
	device := d.Path
	if device == "" {
		device = "/dev/" + d.Name
	}
	return Drive{
		Device:       device,
		Model:        strings.TrimSpace(d.Model),
		SizeBytes:    uint64(d.Size),
		Filesystem:   d.FSType,
		Mountpoint:   d.primaryMount(),
		IsDataTarget: device == dataTarget,
		System:       isSystem(d),
	}
}

// primaryMount returns the device's mountpoint, tolerating both the legacy
// scalar `mountpoint` and the newer `mountpoints` array lsblk emits.
func (d lsblkDevice) primaryMount() string {
	if d.Mountpoint != "" {
		return d.Mountpoint
	}
	for _, mp := range d.Mountpoints {
		if mp != nil && *mp != "" {
			return *mp
		}
	}
	return ""
}

// isSystem reports whether this disk — or any partition beneath it — is mounted
// at a system path, in which case it's locked against all mutation.
func isSystem(d lsblkDevice) bool {
	if d.Mountpoint != "" && systemMounts[d.Mountpoint] {
		return true
	}
	for _, mp := range d.Mountpoints {
		if mp != nil && systemMounts[*mp] {
			return true
		}
	}
	for _, c := range d.Children {
		if isSystem(c) {
			return true
		}
	}
	return false
}

// flexUint64 tolerates lsblk emitting a size as either a JSON number or a string.
type flexUint64 uint64

func (f *flexUint64) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		*f = 0
		return nil
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return err
	}
	*f = flexUint64(n)
	return nil
}

// ─── validation (pure) ───────────────────────────────────────────────────────

func validFilesystem(fs string) error {
	if _, ok := allowedFS[fs]; !ok {
		return fmt.Errorf("%w: unsupported filesystem %q", ErrInvalid, fs)
	}
	return nil
}

func validMountpoint(mp string) error {
	if !filepath.IsAbs(mp) || filepath.Clean(mp) != mp || mp == "/" {
		return fmt.Errorf("%w: bad mountpoint %q", ErrInvalid, mp)
	}
	if systemMounts[mp] {
		return fmt.Errorf("%w: cannot mount onto a system path", ErrInvalid)
	}
	return nil
}

// ─── persistence helpers (privileged, best-effort) ───────────────────────────

// persistFstab adds (or replaces) the device's fstab entry by UUID so the mount
// survives a reboot. Best-effort: a missing blkid or unwritable fstab is logged,
// not fatal — the live mount already succeeded.
func persistFstab(ctx context.Context, device, mountpoint, fs string) {
	uuid := blkidUUID(ctx, device)
	if uuid == "" {
		return
	}
	if fs == "" {
		fs = "auto"
	}
	line := fmt.Sprintf("UUID=%s %s %s defaults 0 2", uuid, mountpoint, fs)
	if err := rewriteFstab(mountpoint, device, line); err != nil {
		slog.Warn("persist fstab failed", "device", device, "err", err)
	}
}

func removeFstab(device, mountpoint string) {
	if err := rewriteFstab(mountpoint, device, ""); err != nil {
		slog.Warn("remove fstab entry failed", "device", device, "err", err)
	}
}

// rewriteFstab drops any existing line referencing mountpoint or device, then
// appends `add` (when non-empty). Reading a missing fstab yields an empty file.
func rewriteFstab(mountpoint, device, add string) error {
	const path = "/etc/fstab"
	existing, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var kept []string
	for _, line := range strings.Split(string(existing), "\n") {
		fields := strings.Fields(line)
		// Drop our managed line for this device/mountpoint; keep comments + others.
		if len(fields) >= 2 && (fields[1] == mountpoint || fields[0] == device) {
			continue
		}
		kept = append(kept, line)
	}
	out := strings.TrimRight(strings.Join(kept, "\n"), "\n")
	if add != "" {
		out += "\n" + add
	}
	return os.WriteFile(path, []byte(out+"\n"), 0o644)
}

func blkidUUID(ctx context.Context, device string) string {
	if _, err := exec.LookPath("blkid"); err != nil {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(cctx, "blkid", "-s", "UUID", "-o", "value", device).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// setDockerDataRoot merges `data-root` into the engine config, preserving any
// other settings the operator set.
func setDockerDataRoot(mountpoint string) error {
	cfg := map[string]any{}
	if b, err := os.ReadFile(dockerConfigPath); err == nil && len(b) > 0 {
		_ = json.Unmarshal(b, &cfg) // ignore a malformed file; we overwrite data-root
	}
	cfg["data-root"] = filepath.Join(mountpoint, "docker")
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dockerConfigPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(dockerConfigPath, out, 0o644)
}

// run executes a host tool with an arg vector (never a shell string) under a
// timeout, surfacing its stderr on failure.
func run(ctx context.Context, timeout time.Duration, name string, args ...string) error {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(string(out)))
	}
	return nil
}
