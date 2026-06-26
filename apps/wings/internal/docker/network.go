package docker

import (
	"context"
	"errors"
	"fmt"
	"net/netip"

	"github.com/moby/moby/api/types/network"
	moby "github.com/moby/moby/client"
)

// NetworkIDLabel tags managed docker networks with the panel's network id, so
// list/remove can scope to ours.
const NetworkIDLabel = "raptorpanel.networkId"

// Network is the projection surfaced to the API.
type Network struct {
	ID        string `json:"id"`
	NetworkID string `json:"networkId"`
	Name      string `json:"name"`
	Driver    string `json:"driver"`
	Subnet    string `json:"subnet,omitempty"`
	Gateway   string `json:"gateway,omitempty"`
}

// NetworkSpec is the panel's request to create a docker network.
type NetworkSpec struct {
	NetworkID string // panel resource id (stamped as a label)
	Name      string // docker network name (daemon prefixes wings-)
	Driver    string // bridge / macvlan / ipvlan; empty → bridge
	Subnet    string // optional CIDR, e.g. 172.28.0.0/16
	Gateway   string // optional gateway ip
}

// CreateNetwork creates a labeled docker network and returns its docker id.
func (c *Client) CreateNetwork(ctx context.Context, spec NetworkSpec) (string, error) {
	if c == nil || c.api == nil {
		return "", errors.New("docker client not initialized")
	}
	driver := spec.Driver
	if driver == "" {
		driver = "bridge"
	}
	opts := moby.NetworkCreateOptions{
		Driver: driver,
		Labels: map[string]string{
			ManagedLabel:   "true",
			NetworkIDLabel: spec.NetworkID,
		},
	}
	if spec.Subnet != "" {
		cfg := network.IPAMConfig{}
		prefix, err := netip.ParsePrefix(spec.Subnet)
		if err != nil {
			return "", fmt.Errorf("parse subnet %q: %w", spec.Subnet, err)
		}
		cfg.Subnet = prefix
		if spec.Gateway != "" {
			gw, err := netip.ParseAddr(spec.Gateway)
			if err != nil {
				return "", fmt.Errorf("parse gateway %q: %w", spec.Gateway, err)
			}
			cfg.Gateway = gw
		}
		opts.IPAM = &network.IPAM{Config: []network.IPAMConfig{cfg}}
	}
	res, err := c.api.NetworkCreate(ctx, "wings-"+spec.Name, opts)
	if err != nil {
		return "", fmt.Errorf("create network %s: %w", spec.Name, err)
	}
	return res.ID, nil
}

// ListManagedNetworks returns every docker network carrying the ManagedLabel.
func (c *Client) ListManagedNetworks(ctx context.Context) ([]Network, error) {
	if c == nil || c.api == nil {
		return nil, errors.New("docker client not initialized")
	}
	f := make(moby.Filters).Add("label", ManagedLabel+"=true")
	res, err := c.api.NetworkList(ctx, moby.NetworkListOptions{Filters: f})
	if err != nil {
		return nil, fmt.Errorf("list networks: %w", err)
	}
	out := make([]Network, 0, len(res.Items))
	for _, n := range res.Items {
		nw := Network{
			ID:        n.ID,
			NetworkID: n.Labels[NetworkIDLabel],
			Name:      n.Name,
			Driver:    n.Driver,
		}
		if len(n.IPAM.Config) > 0 {
			if cfg := n.IPAM.Config[0]; cfg.Subnet.IsValid() {
				nw.Subnet = cfg.Subnet.String()
				if cfg.Gateway.IsValid() {
					nw.Gateway = cfg.Gateway.String()
				}
			}
		}
		out = append(out, nw)
	}
	return out, nil
}

// FindNetworkByNetworkID resolves the docker network id for a panel network id;
// returns "" (no error) when none exists.
func (c *Client) FindNetworkByNetworkID(
	ctx context.Context,
	networkID string,
) (string, error) {
	if c == nil || c.api == nil {
		return "", errors.New("docker client not initialized")
	}
	f := make(moby.Filters).Add("label", NetworkIDLabel+"="+networkID)
	res, err := c.api.NetworkList(ctx, moby.NetworkListOptions{Filters: f})
	if err != nil {
		return "", fmt.Errorf("find network %s: %w", networkID, err)
	}
	if len(res.Items) == 0 {
		return "", nil
	}
	return res.Items[0].ID, nil
}

// RemoveNetwork removes a docker network by its docker id.
func (c *Client) RemoveNetwork(ctx context.Context, dockerNetworkID string) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.NetworkRemove(ctx, dockerNetworkID, moby.NetworkRemoveOptions{}); err != nil {
		return fmt.Errorf("remove network %s: %w", dockerNetworkID, err)
	}
	return nil
}

// ConnectContainer attaches a container to the given docker network id.
func (c *Client) ConnectContainer(
	ctx context.Context,
	dockerNetworkID, containerID string,
) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.NetworkConnect(ctx, dockerNetworkID, moby.NetworkConnectOptions{
		Container: containerID,
	}); err != nil {
		return fmt.Errorf("connect %s to %s: %w", containerID, dockerNetworkID, err)
	}
	return nil
}

// DisconnectContainer detaches a container from the docker network.
func (c *Client) DisconnectContainer(
	ctx context.Context,
	dockerNetworkID, containerID string,
) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.NetworkDisconnect(ctx, dockerNetworkID, moby.NetworkDisconnectOptions{
		Container: containerID,
		Force:     true,
	}); err != nil {
		return fmt.Errorf("disconnect %s from %s: %w", containerID, dockerNetworkID, err)
	}
	return nil
}
