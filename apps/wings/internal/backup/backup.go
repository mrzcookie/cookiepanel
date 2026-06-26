// Package backup snapshots + restores a server's data volume with BorgBackup.
// Borg runs in a short-lived container (internal/docker.RunOnce) that mounts the
// server's volume + a shared repo volume — portable, no host borg install.
//
// Design:
//   - One shared, unencrypted repo in the `wings-backups` volume; a shared repo
//     dedupes across every server on the box (max space savings). Encryption is
//     deferred to off-box/remote targets, where it actually protects data leaving
//     the node (on-box, the live volumes sit next to the repo as plaintext anyway).
//   - Archives are named "<borgId>-<timestamp>" where borgId is the server id with
//     hyphens stripped (a UUID is otherwise not a valid, delimiter-safe borg id).
//   - The panel-facing extras — friendly name, size, lock — live in the local
//     store keyed by archive name; borg owns archive existence + time.
//   - Restore wipes the target volume then extracts (a true point-in-time restore);
//     a manual create runs async (returns "creating"), the scheduler runs it sync.
package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/docker"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/safe"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/store"
)

const (
	// RepoVolume is the managed docker volume holding the borg repo + cache.
	RepoVolume = "wings-backups"
	defaultImg = "bbx0/borgbackup:1.4"
	// volumePrefix must match server.DataVolumeName / filesystem.VolumePrefix.
	volumePrefix = "wings-srv-"
	// createTimeout bounds an async (manual) backup; large volumes need room.
	createTimeout = 60 * time.Minute
)

// Backup statuses surfaced to the panel.
const (
	StatusCreating  = "creating"
	StatusCompleted = "completed"
	StatusFailed    = "failed"
)

// serverIDRE accepts a UUID-shaped server id; borgID strips the hyphens so the
// archive name (hyphen-delimited) and borg glob stay unambiguous.
var serverIDRE = regexp.MustCompile(`^[a-zA-Z0-9-]{1,80}$`)

// ErrLocked is returned when deleting a locked backup.
var ErrLocked = fmt.Errorf("backup is locked")

// Backup is the panel-facing view of one backup.
type Backup struct {
	Archive   string    `json:"archive"` // the id (borg archive name)
	ServerID  string    `json:"serverId"`
	Name      string    `json:"name"`
	SizeBytes int64     `json:"sizeBytes"`
	Status    string    `json:"status"` // creating | completed | failed
	Error     string    `json:"error,omitempty"`
	Locked    bool      `json:"locked"`
	CreatedAt time.Time `json:"createdAt"`
}

// Manager owns backup operations + the in-memory tracker of in-flight (or
// failed) manual creates, which have no borg archive yet.
type Manager struct {
	docker *docker.Client
	store  *store.Store
	image  string

	mu       sync.Mutex
	creating map[string]*createStatus // archive -> status
}

type createStatus struct {
	serverID  string
	name      string
	status    string // creating | failed
	err       string
	createdAt time.Time
}

func NewManager(d *docker.Client, st *store.Store) *Manager {
	return &Manager{
		docker:   d,
		store:    st,
		image:    defaultImg,
		creating: make(map[string]*createStatus),
	}
}

func borgID(serverID string) string { return strings.ReplaceAll(serverID, "-", "") }
func volumeFor(serverID string) string {
	return volumePrefix + serverID
}

func borgEnv() map[string]string {
	return map[string]string{
		"BORG_REPO":      "/borg/repo",
		"BORG_BASE_DIR":  "/borg/base",
		"BORG_CACHE_DIR": "/borg/cache",
		"BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK": "yes",
		"BORG_RELOCATED_REPO_ACCESS_IS_OK":           "yes",
	}
}

func (m *Manager) run(ctx context.Context, script string, mounts []docker.RunMount) (docker.RunResult, error) {
	return m.docker.RunOnce(ctx, docker.RunSpec{
		Image:      m.image,
		Entrypoint: []string{"sh"},
		Cmd:        []string{"-c", script},
		Env:        borgEnv(),
		Mounts:     mounts,
	})
}

func repoMount() docker.RunMount { return docker.RunMount{Volume: RepoVolume, Path: "/borg"} }

// initScript ensures the repo exists; safe to prepend to any mutating script.
const initScript = `borg init -e none "$BORG_REPO" 2>/dev/null || true; `

// sanitizeName bounds the friendly backup name (it's stored, not shell-evaluated).
func sanitizeName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r == '\r' {
			return ' '
		}
		return r
	}, strings.TrimSpace(name))
	if name == "" {
		name = "Backup"
	}
	if len(name) > 100 {
		name = name[:100]
	}
	return name
}

func newArchive(serverID string) string {
	return borgID(serverID) + "-" + time.Now().UTC().Format("20060102T150405Z")
}

// Create kicks off a manual backup in the background and returns the "creating"
// record immediately (a borg create on a large volume can run minutes).
func (m *Manager) Create(serverID, name string) (Backup, error) {
	if !serverIDRE.MatchString(serverID) {
		return Backup{}, fmt.Errorf("invalid server id %q", serverID)
	}
	name = sanitizeName(name)
	archive := newArchive(serverID)
	now := time.Now().UTC()

	m.mu.Lock()
	m.creating[archive] = &createStatus{serverID: serverID, name: name, status: StatusCreating, createdAt: now}
	m.mu.Unlock()

	go func() {
		defer safe.Recover("backup:create:" + archive)
		ctx, cancel := context.WithTimeout(context.Background(), createTimeout)
		defer cancel()
		if err := m.createAndStore(ctx, serverID, archive, name, now); err != nil {
			slog.Error("backup create failed", "server", serverID, "archive", archive, "err", err)
			m.mu.Lock()
			m.creating[archive] = &createStatus{
				serverID: serverID, name: name, status: StatusFailed,
				err: err.Error(), createdAt: now,
			}
			m.mu.Unlock()
			return
		}
		m.mu.Lock()
		delete(m.creating, archive)
		m.mu.Unlock()
	}()

	return Backup{
		Archive: archive, ServerID: serverID, Name: name,
		Status: StatusCreating, CreatedAt: now,
	}, nil
}

// RunBackup creates a backup synchronously (used by the scheduler, whose own
// bounded context times it). Records the metadata on success.
func (m *Manager) RunBackup(ctx context.Context, serverID, name string) error {
	if !serverIDRE.MatchString(serverID) {
		return fmt.Errorf("invalid server id %q", serverID)
	}
	return m.createAndStore(ctx, serverID, newArchive(serverID), sanitizeName(name), time.Now().UTC())
}

// createAndStore runs borg create and, on success, persists the backup metadata.
func (m *Manager) createAndStore(ctx context.Context, serverID, archive, name string, createdAt time.Time) error {
	script := initScript +
		fmt.Sprintf(`cd /source && borg create --json "$BORG_REPO::%s" .`, archive)
	res, err := m.run(ctx, script, []docker.RunMount{
		{Volume: volumeFor(serverID), Path: "/source", ReadOnly: true},
		repoMount(),
	})
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("borg create exit %d: %s", res.ExitCode, tail(res.Output))
	}
	return m.store.PutBackupMeta(store.BackupMeta{
		Archive: archive, ServerID: serverID, Name: name,
		SizeBytes: parseCreateSize(res.Output), Locked: false, CreatedAt: createdAt,
	})
}

// List returns a server's backups (completed archives joined with stored
// metadata, plus any in-flight/failed creates), newest first.
func (m *Manager) List(ctx context.Context, serverID string) ([]Backup, error) {
	if !serverIDRE.MatchString(serverID) {
		return nil, fmt.Errorf("invalid server id %q", serverID)
	}
	prefix := borgID(serverID) + "-"
	archives, err := m.listArchives(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Backup, 0, len(archives))
	for _, a := range archives {
		if !strings.HasPrefix(a.name, prefix) {
			continue
		}
		if meta, ok, _ := m.store.GetBackupMeta(a.name); ok {
			out = append(out, Backup{
				Archive: a.name, ServerID: serverID, Name: meta.Name,
				SizeBytes: meta.SizeBytes, Status: StatusCompleted,
				Locked: meta.Locked, CreatedAt: meta.CreatedAt,
			})
			continue
		}
		// Archive with no stored metadata (created out-of-band): show it plainly.
		out = append(out, Backup{
			Archive: a.name, ServerID: serverID, Name: a.name,
			Status: StatusCompleted, CreatedAt: a.time,
		})
	}
	m.mu.Lock()
	for archive, st := range m.creating {
		if st.serverID == serverID {
			out = append(out, Backup{
				Archive: archive, ServerID: serverID, Name: st.name,
				Status: st.status, Error: st.err, CreatedAt: st.createdAt,
			})
		}
	}
	m.mu.Unlock()

	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

// Restore wipes the server's data volume then extracts the archive into it. The
// archive must belong to the server (cross-server restore is refused). The caller
// is expected to have stopped the server.
func (m *Manager) Restore(ctx context.Context, serverID, archive string) error {
	if err := m.guardOwnership(serverID, archive); err != nil {
		return err
	}
	script := initScript +
		`find /restore -mindepth 1 -delete 2>/dev/null; ` +
		fmt.Sprintf(`cd /restore && borg extract "$BORG_REPO::%s"`, archive)
	res, err := m.run(ctx, script, []docker.RunMount{
		{Volume: volumeFor(serverID), Path: "/restore"},
		repoMount(),
	})
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("borg extract exit %d: %s", res.ExitCode, tail(res.Output))
	}
	return nil
}

// Delete removes a backup. A locked backup, or one still being created, is
// refused; a failed in-flight record is just dropped.
func (m *Manager) Delete(ctx context.Context, serverID, archive string) error {
	if err := m.guardOwnership(serverID, archive); err != nil {
		return err
	}
	m.mu.Lock()
	st, inFlight := m.creating[archive]
	m.mu.Unlock()
	if inFlight {
		if st.status == StatusFailed {
			m.mu.Lock()
			delete(m.creating, archive)
			m.mu.Unlock()
			return nil
		}
		return fmt.Errorf("backup is still being created")
	}
	if meta, ok, _ := m.store.GetBackupMeta(archive); ok && meta.Locked {
		return ErrLocked
	}
	script := initScript + fmt.Sprintf(`borg delete "$BORG_REPO::%s"`, archive)
	res, err := m.run(ctx, script, []docker.RunMount{repoMount()})
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return fmt.Errorf("borg delete exit %d: %s", res.ExitCode, tail(res.Output))
	}
	return m.store.DeleteBackupMeta(archive)
}

// SetLock locks/unlocks a backup against deletion (stored metadata).
func (m *Manager) SetLock(serverID, archive string, locked bool) error {
	if err := m.guardOwnership(serverID, archive); err != nil {
		return err
	}
	err := m.store.UpdateBackupMeta(archive, func(meta *store.BackupMeta) {
		meta.Locked = locked
	})
	if err == store.ErrBackupMetaMissing {
		return fmt.Errorf("backup not found")
	}
	return err
}

// guardOwnership validates the archive name belongs to serverID — the cross-
// server restore/delete guard (an archive is "<borgId>-<timestamp>").
func (m *Manager) guardOwnership(serverID, archive string) error {
	if !serverIDRE.MatchString(serverID) {
		return fmt.Errorf("invalid server id %q", serverID)
	}
	prefix := borgID(serverID) + "-"
	ts := strings.TrimPrefix(archive, prefix)
	if !strings.HasPrefix(archive, prefix) || !tsRE.MatchString(ts) {
		return fmt.Errorf("archive %q does not belong to this server", archive)
	}
	return nil
}

var tsRE = regexp.MustCompile(`^[0-9]{8}T[0-9]{6}Z$`)

type rawArchive struct {
	name string
	time time.Time
}

// listArchives runs `borg list --json` and returns every archive in the repo.
func (m *Manager) listArchives(ctx context.Context) ([]rawArchive, error) {
	script := initScript + `borg list --json "$BORG_REPO"`
	res, err := m.run(ctx, script, []docker.RunMount{repoMount()})
	if err != nil {
		return nil, err
	}
	if res.ExitCode != 0 {
		return nil, fmt.Errorf("borg list exit %d: %s", res.ExitCode, tail(res.Output))
	}
	brace := strings.IndexByte(res.Output, '{')
	if brace < 0 {
		return nil, fmt.Errorf("borg list: no JSON in output: %s", tail(res.Output))
	}
	var parsed struct {
		Archives []struct {
			Name  string `json:"name"`
			Time  string `json:"time"`
			Start string `json:"start"`
		} `json:"archives"`
	}
	if err := json.Unmarshal([]byte(res.Output[brace:]), &parsed); err != nil {
		return nil, fmt.Errorf("parse borg list: %w", err)
	}
	out := make([]rawArchive, 0, len(parsed.Archives))
	for _, a := range parsed.Archives {
		ts := a.Time
		if ts == "" {
			ts = a.Start
		}
		out = append(out, rawArchive{name: a.Name, time: parseBorgTime(ts)})
	}
	return out, nil
}

// parseCreateSize pulls the new archive's original size out of `borg create
// --json` output (0 if it can't be found — size is informational).
func parseCreateSize(output string) int64 {
	brace := strings.IndexByte(output, '{')
	if brace < 0 {
		return 0
	}
	var parsed struct {
		Archive struct {
			Stats struct {
				OriginalSize int64 `json:"original_size"`
			} `json:"stats"`
		} `json:"archive"`
	}
	if err := json.Unmarshal([]byte(output[brace:]), &parsed); err != nil {
		return 0
	}
	return parsed.Archive.Stats.OriginalSize
}

// parseBorgTime parses borg's naive timestamp as UTC; zero time if it doesn't
// match (the panel renders that as "unknown").
func parseBorgTime(s string) time.Time {
	for _, layout := range []string{"2006-01-02T15:04:05.000000", "2006-01-02T15:04:05", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func tail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 400 {
		return "…" + s[len(s)-400:]
	}
	return s
}
