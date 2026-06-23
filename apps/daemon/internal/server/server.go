// Package server is the daemon's server (container) lifecycle: create a server
// from a template's image, then start / stop / restart / delete it. A server is
// a labelled container created from an image with env + an optional port binding.
// The egg install pipeline, named-volume persistence, console attach, and disk
// usage land in later slices.
package server

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/cookiepanel/cookied/internal/docker"
)

// nameRE validates the panel-supplied name; the container name is `cookied-<name>`.
var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

// Manager owns server-container lifecycle over the docker client.
type Manager struct {
	docker *docker.Client
}

// NewManager builds a Manager. The docker client may be nil/unavailable; the
// lifecycle methods then surface a clear error rather than panicking.
func NewManager(d *docker.Client) *Manager {
	return &Manager{docker: d}
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
	StopSignal     string            `json:"stopSignal,omitempty"`
	PortBinding    *PortBinding      `json:"portBinding,omitempty"`
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
}

// Create pulls the image, creates the labelled container, and starts it. Rolls
// the container back if it fails to start. Refuses if one already exists for the
// server id (idempotency guard).
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
	existing, err := m.docker.InspectByServerID(ctx, req.ServerID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, fmt.Errorf(
			"server %s already has container %s", req.ServerID, existing.ID[:12],
		)
	}

	if err := m.docker.PullImage(ctx, req.Image); err != nil {
		return nil, err
	}

	spec := docker.CreateSpec{
		ServerID:       req.ServerID,
		Name:           "cookied-" + req.Name,
		Image:          req.Image,
		StartupCommand: req.StartupCommand,
		Env:            req.Env,
		NanoCPUs:       req.NanoCPUs,
		MemoryMB:       req.MemoryMB,
		StopSignal:     req.StopSignal,
	}
	if req.PortBinding != nil {
		spec.PortBinding = &docker.PortBinding{
			HostIP:        req.PortBinding.HostIP,
			HostPort:      req.PortBinding.HostPort,
			ContainerPort: req.PortBinding.ContainerPort,
			Protocol:      req.PortBinding.Protocol,
		}
	}

	id, err := m.docker.CreateContainer(ctx, spec)
	if err != nil {
		return nil, err
	}
	if err := m.docker.StartContainer(ctx, id); err != nil {
		_ = m.docker.RemoveContainer(context.Background(), id, true)
		return nil, err
	}
	return m.snapshotByServerID(ctx, req.ServerID)
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

// Delete removes the server's container. A missing container is not an error
// (the desired end-state is "gone").
func (m *Manager) Delete(ctx context.Context, serverID string) error {
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return err
	}
	if c == nil {
		return nil
	}
	return m.docker.RemoveContainer(ctx, c.ID, true)
}

// Get returns the server snapshot, or (nil, nil) if no container exists for it.
func (m *Manager) Get(ctx context.Context, serverID string) (*Server, error) {
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	return toServer(c), nil
}

// List returns every managed server container on this box.
func (m *Manager) List(ctx context.Context) ([]Server, error) {
	cs, err := m.docker.ListManaged(ctx, docker.KindServer)
	if err != nil {
		return nil, err
	}
	out := make([]Server, 0, len(cs))
	for i := range cs {
		out = append(out, *toServer(&cs[i]))
	}
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
