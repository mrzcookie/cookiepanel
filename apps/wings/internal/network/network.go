// Package network manages Docker networks on the node: create/list/remove with
// bridge/macvlan/ipvlan drivers + subnet/gateway config, and attaching or
// detaching a server's container. Thin over the docker package, which owns the
// managed-resource labelling.
package network

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/xena-studios/raptor/apps/wings/internal/docker"
)

var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,62}$`)

// CreateRequest is the api-layer view of a network to create.
type CreateRequest struct {
	NetworkID string `json:"networkId"`
	Name      string `json:"name"`
	Driver    string `json:"driver,omitempty"`
	Subnet    string `json:"subnet,omitempty"`
	Gateway   string `json:"gateway,omitempty"`
}

// AttachRequest connects/disconnects a server's container to a network.
type AttachRequest struct {
	ServerID string `json:"serverId"`
}

// Network is the snapshot returned to the panel.
type Network = docker.Network

// Manager owns docker-network lifecycle ops.
type Manager struct {
	docker *docker.Client
}

func NewManager(d *docker.Client) *Manager {
	return &Manager{docker: d}
}

func (m *Manager) Create(ctx context.Context, req CreateRequest) (*Network, error) {
	if req.NetworkID == "" {
		return nil, errors.New("networkId is required")
	}
	if !nameRE.MatchString(req.Name) {
		return nil, fmt.Errorf("name %q must match %s", req.Name, nameRE)
	}
	existing, err := m.docker.FindNetworkByNetworkID(ctx, req.NetworkID)
	if err != nil {
		return nil, err
	}
	if existing != "" {
		return nil, fmt.Errorf(
			"network %s already exists (%s)", req.NetworkID, existing[:12],
		)
	}
	if _, err := m.docker.CreateNetwork(ctx, docker.NetworkSpec{
		NetworkID: req.NetworkID,
		Name:      req.Name,
		Driver:    req.Driver,
		Subnet:    req.Subnet,
		Gateway:   req.Gateway,
	}); err != nil {
		return nil, err
	}
	return m.getByNetworkID(ctx, req.NetworkID)
}

func (m *Manager) List(ctx context.Context) ([]Network, error) {
	return m.docker.ListManagedNetworks(ctx)
}

// Delete removes the docker network. Idempotent: a missing network is a no-op.
func (m *Manager) Delete(ctx context.Context, networkID string) error {
	dockerID, err := m.docker.FindNetworkByNetworkID(ctx, networkID)
	if err != nil {
		return err
	}
	if dockerID == "" {
		return nil
	}
	return m.docker.RemoveNetwork(ctx, dockerID)
}

// Attach connects the server's container to the network.
func (m *Manager) Attach(ctx context.Context, networkID, serverID string) error {
	dockerID, containerID, err := m.resolve(ctx, networkID, serverID)
	if err != nil {
		return err
	}
	return m.docker.ConnectContainer(ctx, dockerID, containerID)
}

// Detach disconnects the server's container from the network.
func (m *Manager) Detach(ctx context.Context, networkID, serverID string) error {
	dockerID, containerID, err := m.resolve(ctx, networkID, serverID)
	if err != nil {
		return err
	}
	return m.docker.DisconnectContainer(ctx, dockerID, containerID)
}

func (m *Manager) resolve(
	ctx context.Context,
	networkID, serverID string,
) (dockerNetworkID, containerID string, err error) {
	dockerNetworkID, err = m.docker.FindNetworkByNetworkID(ctx, networkID)
	if err != nil {
		return "", "", err
	}
	if dockerNetworkID == "" {
		return "", "", fmt.Errorf("network %s not found", networkID)
	}
	c, err := m.docker.InspectByServerID(ctx, serverID)
	if err != nil {
		return "", "", err
	}
	if c == nil {
		return "", "", fmt.Errorf("no container for server %s", serverID)
	}
	return dockerNetworkID, c.ID, nil
}

func (m *Manager) getByNetworkID(
	ctx context.Context,
	networkID string,
) (*Network, error) {
	list, err := m.docker.ListManagedNetworks(ctx)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].NetworkID == networkID {
			return &list[i], nil
		}
	}
	return nil, fmt.Errorf("network %s missing after create", networkID)
}
