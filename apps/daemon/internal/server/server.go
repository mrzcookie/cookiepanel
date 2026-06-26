// Package server is the daemon's server (container) lifecycle: create a server
// from a template's image, then start / stop / restart / delete it. A server is
// a labelled container created from an image with env, an optional port binding,
// and a per-server named data volume mounted at /data (its working directory) so
// its files survive a recreate and the file manager can reach them on the host.
//
// A template with an install script runs it **once** in a throwaway container
// before the long-lived container exists (the egg install pipeline). That can
// take minutes, so create is asynchronous for installs: it returns "installing"
// immediately and runs install→create→start in the background, tracking the
// transient state in-memory (Get/List report it until the container exists).
// Managed config files are merged into the data volume after install and before
// the container starts. The data volume is best-effort capped at the server's
// disk limit (XFS project quota; a no-op where the FS doesn't support it).
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sync"

	"github.com/cookiepanel/cookied/internal/diskquota"
	"github.com/cookiepanel/cookied/internal/docker"
	"github.com/cookiepanel/cookied/internal/filesystem"
	"github.com/cookiepanel/cookied/internal/safe"
)

// nameRE validates the panel-supplied name; the container name is `cookied-<name>`.
var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

// dataVolumePrefix + dataMountPath define the per-server data volume. The prefix
// MUST match filesystem.VolumePrefix so the file manager resolves the same
// volume the container writes to.
const (
	dataVolumePrefix = "cookied-srv-"
	dataMountPath    = "/data"
)

// DataVolumeName is the named volume holding a server's data.
func DataVolumeName(serverID string) string { return dataVolumePrefix + serverID }

// Manager owns server-container lifecycle over the docker client. It also tracks
// in-progress (and failed) installs in-memory, since during an install there's no
// long-lived container for Get/List to read state from.
type Manager struct {
	docker *docker.Client
	files  *filesystem.Manager // for writing managed config files into the volume

	mu       sync.Mutex
	installs map[string]*installStatus
}

// installStatus is the transient state of a server whose install is running or
// failed — held only until the long-lived container exists (success) or the
// server is deleted. Lost on daemon restart (a rare mid-install crash).
type installStatus struct {
	state  string             // stateInstalling | stateFailed
	err    string             // failure detail, for stateFailed
	cancel context.CancelFunc // aborts the in-flight install goroutine (delete)
}

const (
	stateInstalling = "installing"
	stateFailed     = "failed"
)

// NewManager builds a Manager. The docker client may be nil/unavailable; the
// lifecycle methods then surface a clear error rather than panicking.
func NewManager(d *docker.Client) *Manager {
	return &Manager{
		docker:   d,
		files:    filesystem.New(d),
		installs: make(map[string]*installStatus),
	}
}

func (m *Manager) getInstall(serverID string) *installStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.installs[serverID]
}

// finishInstall records the install's outcome, but only if `want` is still the
// current record — so a delete that raced the goroutine isn't undone (the
// goroutine would otherwise re-add a "failed" entry after its ctx was cancelled).
func (m *Manager) finishInstall(serverID string, want *installStatus, failErr error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.installs[serverID] != want {
		return
	}
	if failErr == nil {
		delete(m.installs, serverID)
		return
	}
	m.installs[serverID] = &installStatus{state: stateFailed, err: failErr.Error()}
}

// cancelInstall aborts an in-flight install and drops the record (used by delete).
func (m *Manager) cancelInstall(serverID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if st := m.installs[serverID]; st != nil {
		if st.cancel != nil {
			st.cancel()
		}
		delete(m.installs, serverID)
	}
}

// PortBinding maps a host ip+port onto a container port.
type PortBinding struct {
	HostIP        string `json:"hostIp"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol,omitempty"`
}

// CreateRequest is what the panel POSTs to create a server.
type CreateRequest struct {
	ServerID       string            `json:"serverId"`
	Name           string            `json:"name"`
	Image          string            `json:"image"`
	StartupCommand string            `json:"startupCommand,omitempty"`
	Env            map[string]string `json:"env,omitempty"`
	NanoCPUs       int64             `json:"nanoCpus,omitempty"`
	MemoryMB       int               `json:"memoryMb,omitempty"`
	// DiskMB is a best-effort hard cap on the data volume (XFS project quota; a
	// no-op where the FS doesn't support it). Zero = uncapped.
	DiskMB      int          `json:"diskMb,omitempty"`
	StopSignal  string       `json:"stopSignal,omitempty"`
	PortBinding *PortBinding `json:"portBinding,omitempty"`
	// Install, when set, is an egg install step run once (in its own throwaway
	// container, data volume at /mnt/server) before the long-lived container.
	Install *InstallSpec `json:"install,omitempty"`
	// ConfigFiles are merged into the data volume after install and before the
	// container starts, so the process boots with the right config (the panel has
	// already substituted {{token}} values into Replace).
	ConfigFiles []ConfigFile `json:"configFiles,omitempty"`
}

// InstallSpec is an egg's installation script. The script runs as
// `entrypoint -c <script>` inside Image, with Env exported.
type InstallSpec struct {
	Image      string            `json:"image"`
	Entrypoint string            `json:"entrypoint"`
	Script     string            `json:"script"`
	Env        map[string]string `json:"env,omitempty"`
}

// ConfigFile describes a managed config file. The daemon merges Replace into the
// existing file (creating it if absent) using the named parser. Replace values
// are already substituted by the panel.
type ConfigFile struct {
	File    string            `json:"file"`
	Parser  string            `json:"parser"`
	Replace map[string]string `json:"replace"`
}

// Server is the daemon's snapshot of a server, returned to the panel. State and
// Status are Docker's raw values; the panel maps them onto its domain vocabulary.
type Server struct {
	ServerID    string `json:"serverId"`
	Name        string `json:"name"`
	ContainerID string `json:"containerId"`
	Image       string `json:"image"`
	State       string `json:"state"`
	Status      string `json:"status"`
	// Error carries the failure detail when State is "failed" (e.g. a non-zero
	// install script), so the panel can surface it as the server's lastError.
	Error string `json:"error,omitempty"`
}

// Create provisions a server. Without an install step it runs synchronously
// (pull → create → start) and returns the live snapshot. With an install step it
// returns "installing" immediately and runs install→create→start in the
// background (the install can take minutes); Get/List report the transient state.
// Refuses if a container or an in-progress install already exists for the id.
func (m *Manager) Create(ctx context.Context, req CreateRequest) (*Server, error) {
	if req.ServerID == "" {
		return nil, errors.New("serverId is required")
	}
	if req.Image == "" {
		return nil, errors.New("image is required")
	}
	if !nameRE.MatchString(req.Name) {
		return nil, fmt.Errorf("name %q must match %s", req.Name, nameRE)
	}
	if m.getInstall(req.ServerID) != nil {
		return nil, fmt.Errorf("server %s is already installing", req.ServerID)
	}
	existing, err := m.docker.InspectByServerID(ctx, req.ServerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, fmt.Errorf(
			"server %s already has container %s", req.ServerID, existing.ID[:12],
		)
	}

	// The data volume holds the server's files (mounted at /data, its working
	// directory) and is where the install step lays them down. Created
	// idempotently before either so a recreate reuses the same data.
	volName := DataVolumeName(req.ServerID)
	if err := m.docker.CreateVolume(ctx, volName, req.ServerID); err != nil {
		return nil, err
	}
	// Cap the volume up front (before the install writes into it) so the install
	// itself respects the disk allocation. Best-effort — never fails the create.
	m.applyQuota(ctx, volName, req.DiskMB)
	spec := m.buildSpec(req, volName)

	// No install → provision synchronously and return the live snapshot.
	if req.Install == nil {
		if err := m.provision(ctx, req, spec); err != nil {
			return nil, err
		}
		return m.snapshotByServerID(ctx, req.ServerID)
	}

	// Install → run install→create→start in the background, reporting "installing"
	// now. A detached context (bounded by provisionTimeout) so the work outlives
	// the create request; the record's cancel lets delete abort it.
	bg, cancel := context.WithTimeout(context.Background(), provisionTimeout)
	st := &installStatus{state: stateInstalling, cancel: cancel}
	m.mu.Lock()
	m.installs[req.ServerID] = st
	m.mu.Unlock()
	go func() {
		defer safe.Recover("server:install:" + req.ServerID)
		defer cancel()
		if err := m.provision(bg, req, spec); err != nil {
			slog.Error("server install failed", "server", req.ServerID, "err", err)
			m.finishInstall(req.ServerID, st, err)
			return
		}
		m.finishInstall(req.ServerID, st, nil)
	}()
	return &Server{
		ServerID: req.ServerID,
		Name:     spec.Name,
		Image:    req.Image,
		State:    stateInstalling,
	}, nil
}

// buildSpec maps a CreateRequest onto the docker create spec (name prefix, data
// volume mount, optional port binding).
func (m *Manager) buildSpec(req CreateRequest, volName string) docker.CreateSpec {
	spec := docker.CreateSpec{
		ServerID:       req.ServerID,
		Name:           "cookied-" + req.Name,
		Image:          req.Image,
		StartupCommand: req.StartupCommand,
		Env:            req.Env,
		NanoCPUs:       req.NanoCPUs,
		MemoryMB:       req.MemoryMB,
		StopSignal:     req.StopSignal,
		Volumes:        []docker.VolumeMount{{Name: volName, Path: dataMountPath}},
		WorkingDir:     dataMountPath,
	}
	if req.PortBinding != nil {
		spec.PortBinding = &docker.PortBinding{
			HostIP:        req.PortBinding.HostIP,
			HostPort:      req.PortBinding.HostPort,
			ContainerPort: req.PortBinding.ContainerPort,
			Protocol:      req.PortBinding.Protocol,
		}
	}
	return spec
}

// applyQuota best-effort caps the server's data volume at diskMB via an XFS
// project quota on its host directory. A no-op for an unset limit, an unresolvable
// mountpoint, or a filesystem that doesn't support project quotas — it logs and
// returns, never failing the create.
func (m *Manager) applyQuota(ctx context.Context, volName string, diskMB int) {
	if diskMB <= 0 {
		return
	}
	dir, err := m.docker.VolumeMountpoint(ctx, volName)
	if err != nil {
		slog.Warn("disk quota: resolve volume mountpoint", "volume", volName, "err", err)
		return
	}
	enforced, err := diskquota.Apply(ctx, dir, int64(diskMB)*1024*1024)
	if err != nil {
		slog.Warn("disk quota apply failed (continuing)", "volume", volName, "err", err)
		return
	}
	if enforced {
		slog.Info("disk quota applied", "volume", volName, "diskMb", diskMB)
	}
}

// provision pulls the runtime image, runs the install step (if any) into the data
// volume, then creates + starts the long-lived container — rolling the container
// back if it fails to start. Shared by the sync + async create paths.
func (m *Manager) provision(
	ctx context.Context,
	req CreateRequest,
	spec docker.CreateSpec,
) error {
	if err := m.docker.PullImage(ctx, req.Image); err != nil {
		return err
	}
	if req.Install != nil {
		if err := m.runInstall(ctx, req); err != nil {
			return err
		}
	}
	// Write managed config files into the volume after install (which may lay
	// down the initial files) and before the container boots.
	if len(req.ConfigFiles) > 0 {
		if err := m.applyConfigFiles(ctx, req.ServerID, req.ConfigFiles); err != nil {
			return err
		}
	}
	id, err := m.docker.CreateContainer(ctx, spec)
	if err != nil {
		return err
	}
	if err := m.docker.StartContainer(ctx, id); err != nil {
		_ = m.docker.RemoveContainer(context.Background(), id, true)
		return err
	}
	return nil
}

func (m *Manager) Start(ctx context.Context, serverID string) (*Server, error) {
	c, err := m.requireContainer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if err := m.docker.StartContainer(ctx, c.ID); err != nil {
		return nil, err
	}
	return m.snapshotByServerID(ctx, serverID)
}

func (m *Manager) Stop(ctx context.Context, serverID string) (*Server, error) {
	c, err := m.requireContainer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if err := m.docker.StopContainer(ctx, c.ID); err != nil {
		return nil, err
	}
	return m.snapshotByServerID(ctx, serverID)
}

func (m *Manager) Restart(ctx context.Context, serverID string) (*Server, error) {
	c, err := m.requireContainer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if err := m.docker.StopContainer(ctx, c.ID); err != nil {
		return nil, err
	}
	if err := m.docker.StartContainer(ctx, c.ID); err != nil {
		return nil, err
	}
	return m.snapshotByServerID(ctx, serverID)
}

// SendCommand writes a line to the server's container stdin (the console).
func (m *Manager) SendCommand(
	ctx context.Context,
	serverID, command string,
) error {
	c, err := m.requireContainer(ctx, serverID)
	if err != nil {
		return err
	}
	return m.docker.SendCommand(ctx, c.ID, command)
}

// Delete removes the server's container and its data volume. A missing container
// is not an error (the desired end-state is "gone"); the volume is torn down
// regardless so deleting a server reclaims its disk. Any in-flight or failed
// install is aborted + dropped first.
func (m *Manager) Delete(ctx context.Context, serverID string) error {
	m.cancelInstall(serverID)
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return err
	}
	if c != nil {
		if err := m.docker.RemoveContainer(ctx, c.ID, true); err != nil {
			return err
		}
	}
	// Named volumes outlive ContainerRemove's anonymous-only cleanup, so tear the
	// server's data volume down explicitly.
	return m.docker.RemoveVolumesByServerID(ctx, serverID)
}

// Get returns the server snapshot, or (nil, nil) if no container exists for it.
// A server mid-install (or with a failed install) has no container yet, so its
// transient state is reported from the install tracker.
func (m *Manager) Get(ctx context.Context, serverID string) (*Server, error) {
	if st := m.getInstall(serverID); st != nil {
		return &Server{ServerID: serverID, State: st.state, Error: st.err}, nil
	}
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	return toServer(c), nil
}

// List returns every managed server container on this box, plus any servers that
// are mid-install / failed-install (which have no container yet).
func (m *Manager) List(ctx context.Context) ([]Server, error) {
	cs, err := m.docker.ListManaged(ctx, docker.KindServer)
	if err != nil {
		return nil, err
	}
	out := make([]Server, 0, len(cs))
	for i := range cs {
		out = append(out, *toServer(&cs[i]))
	}
	m.mu.Lock()
	for id, st := range m.installs {
		out = append(out, Server{ServerID: id, State: st.state, Error: st.err})
	}
	m.mu.Unlock()
	return out, nil
}

func (m *Manager) requireContainer(
	ctx context.Context,
	serverID string,
) (*docker.Container, error) {
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, fmt.Errorf("no container for server %s", serverID)
	}
	return c, nil
}

func (m *Manager) snapshotByServerID(
	ctx context.Context,
	serverID string,
) (*Server, error) {
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, fmt.Errorf("post-op snapshot missing for server %s", serverID)
	}
	return toServer(c), nil
}

func toServer(c *docker.Container) *Server {
	return &Server{
		ServerID:    c.ServerID,
		Name:        c.Name,
		ContainerID: c.ID,
		Image:       c.Image,
		State:       c.State,
		Status:      c.Status,
	}
}
