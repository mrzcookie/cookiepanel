// Package docker wraps the Docker Engine API client with the small surface the
// daemon needs to manage server containers: an info probe, and the no-install
// container lifecycle (pull / create / start / stop / remove / list / inspect).
// Every managed container is labelled `cookiepanel.*` so the daemon only ever
// touches its own resources. Named volumes, the egg install pipeline, console
// log/stat streaming, and prune land in later slices.
package docker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"strings"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	moby "github.com/moby/moby/client"
)

// Labels applied to every container the daemon manages, so docker queries can
// scope to "ours" without colliding with whatever else the operator runs.
const (
	ManagedLabel  = "cookiepanel.managed"
	ServerIDLabel = "cookiepanel.serverId"
	KindLabel     = "cookiepanel.kind"
)

// KindServer is the value stamped into KindLabel for managed server containers.
const KindServer = "server"

// Client wraps the Engine API client. Nil-tolerant: every method guards a nil
// client so the daemon keeps running (and heartbeating) when docker is absent.
type Client struct {
	api *moby.Client
}

// New constructs a client honoring DOCKER_HOST + standard env vars. It does not
// contact the engine; call Probe to verify reachability.
func New() (*Client, error) {
	c, err := moby.NewClientWithOpts(moby.FromEnv, moby.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}
	return &Client{api: c}, nil
}

// Close releases the underlying client.
func (c *Client) Close() error {
	if c == nil || c.api == nil {
		return nil
	}
	return c.api.Close()
}

// Info is the small docker snapshot shipped to the panel each heartbeat.
type Info struct {
	Available     bool   `json:"available"`
	ServerVersion string `json:"serverVersion,omitempty"`
	Containers    int    `json:"containers"`
	Running       int    `json:"running"`
	Images        int    `json:"images"`
	Error         string `json:"error,omitempty"`
}

// Probe never returns an error: a down/unreachable engine yields
// Info{Available:false, Error:…} so the daemon can still heartbeat.
func (c *Client) Probe(ctx context.Context) Info {
	if c == nil || c.api == nil {
		return Info{Error: "docker client not initialized"}
	}
	info, err := c.api.Info(ctx, moby.InfoOptions{})
	if err != nil {
		return Info{Error: trimDockerErr(err)}
	}
	return Info{
		Available:     true,
		ServerVersion: info.Info.ServerVersion,
		Containers:    info.Info.Containers,
		Running:       info.Info.ContainersRunning,
		Images:        info.Info.Images,
	}
}

// ─── Container lifecycle ─────────────────────────────────────────────────────

// CreateSpec is the daemon's image-agnostic view of a container to create.
type CreateSpec struct {
	ServerID       string
	Name           string
	Image          string
	StartupCommand string
	Env            map[string]string
	// NanoCPUs is a hard CPU cap in billionths of a core (1.5 cores =
	// 1_500_000_000); 0 = uncapped. MemoryMB caps RAM.
	NanoCPUs    int64
	MemoryMB    int
	StopSignal  string
	PortBinding *PortBinding
}

// PortBinding maps a host ip+port onto a container port.
type PortBinding struct {
	HostIP        string
	HostPort      int
	ContainerPort int
	// Protocol is "tcp" (default) or "udp".
	Protocol string
}

// Container is the projection of a docker container summary the daemon surfaces,
// so this package stays the only thing that imports moby.
type Container struct {
	ID       string            `json:"id"`
	ServerID string            `json:"serverId"`
	Kind     string            `json:"kind"`
	Image    string            `json:"image"`
	Name     string            `json:"name"`
	State    string            `json:"state"`
	Status   string            `json:"status"`
	Labels   map[string]string `json:"labels,omitempty"`
}

// PullImage pulls refStr from the registry, blocking until the pull finishes.
func (c *Client) PullImage(ctx context.Context, refStr string) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	res, err := c.api.ImagePull(ctx, refStr, moby.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("pull %s: %w", refStr, err)
	}
	defer res.Close()
	if err := res.Wait(ctx); err != nil {
		return fmt.Errorf("pull %s: %w", refStr, err)
	}
	return nil
}

// CreateContainer creates a container from spec. Create and Start are kept
// separate so a failure to start surfaces as a distinct, recoverable state.
func (c *Client) CreateContainer(ctx context.Context, spec CreateSpec) (string, error) {
	if c == nil || c.api == nil {
		return "", errors.New("docker client not initialized")
	}
	cfg := &container.Config{
		Image: spec.Image,
		Env:   envToSlice(spec.Env),
		Labels: map[string]string{
			ManagedLabel:  "true",
			ServerIDLabel: spec.ServerID,
			KindLabel:     KindServer,
		},
		// Keep stdin open so the daemon can deliver console commands to the main
		// process later. Tty stays false so the log stream stays stdcopy-multiplexed.
		OpenStdin: true,
	}
	if spec.StartupCommand != "" {
		// Wrap in `sh -c` so users write arbitrary command lines without thinking
		// about argv splitting.
		cfg.Cmd = []string{"sh", "-c", spec.StartupCommand}
	}
	if spec.StopSignal != "" {
		cfg.StopSignal = spec.StopSignal
	}
	host := &container.HostConfig{
		RestartPolicy: container.RestartPolicy{
			Name:              container.RestartPolicyOnFailure,
			MaximumRetryCount: 3,
		},
	}
	if spec.NanoCPUs > 0 {
		host.NanoCPUs = spec.NanoCPUs
	}
	if spec.MemoryMB > 0 {
		host.Memory = int64(spec.MemoryMB) * 1024 * 1024
	}
	if spec.PortBinding != nil {
		proto := spec.PortBinding.Protocol
		if proto != "udp" {
			proto = "tcp"
		}
		cport, err := network.ParsePort(
			fmt.Sprintf("%d/%s", spec.PortBinding.ContainerPort, proto),
		)
		if err != nil {
			return "", fmt.Errorf("parse container port: %w", err)
		}
		hostIP, err := netip.ParseAddr(spec.PortBinding.HostIP)
		if err != nil {
			return "", fmt.Errorf("parse host ip %q: %w", spec.PortBinding.HostIP, err)
		}
		cfg.ExposedPorts = network.PortSet{cport: struct{}{}}
		host.PortBindings = network.PortMap{
			cport: []network.PortBinding{{
				HostIP:   hostIP,
				HostPort: fmt.Sprintf("%d", spec.PortBinding.HostPort),
			}},
		}
	}
	res, err := c.api.ContainerCreate(ctx, moby.ContainerCreateOptions{
		Config:     cfg,
		HostConfig: host,
		Name:       spec.Name,
	})
	if err != nil {
		return "", fmt.Errorf("create container %s: %w", spec.Name, err)
	}
	return res.ID, nil
}

func (c *Client) StartContainer(ctx context.Context, id string) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.ContainerStart(ctx, id, moby.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("start %s: %w", id, err)
	}
	return nil
}

func (c *Client) StopContainer(ctx context.Context, id string) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.ContainerStop(ctx, id, moby.ContainerStopOptions{}); err != nil {
		return fmt.Errorf("stop %s: %w", id, err)
	}
	return nil
}

func (c *Client) RemoveContainer(ctx context.Context, id string, force bool) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	if _, err := c.api.ContainerRemove(ctx, id, moby.ContainerRemoveOptions{
		Force:         force,
		RemoveVolumes: true,
	}); err != nil {
		return fmt.Errorf("remove %s: %w", id, err)
	}
	return nil
}

// ListManaged returns every managed container (optionally of a given kind),
// scoped by the managed label so it never sees the operator's own containers.
func (c *Client) ListManaged(ctx context.Context, kind string) ([]Container, error) {
	if c == nil || c.api == nil {
		return nil, errors.New("docker client not initialized")
	}
	f := make(moby.Filters).Add("label", ManagedLabel+"=true")
	if kind != "" {
		f.Add("label", KindLabel+"="+kind)
	}
	res, err := c.api.ContainerList(ctx, moby.ContainerListOptions{All: true, Filters: f})
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}
	out := make([]Container, 0, len(res.Items))
	for _, s := range res.Items {
		out = append(out, summaryToContainer(s))
	}
	return out, nil
}

// InspectByServerID returns the managed container for a server id, or (nil, nil)
// when none exists yet — the convention the server Manager relies on.
func (c *Client) InspectByServerID(ctx context.Context, id string) (*Container, error) {
	if c == nil || c.api == nil {
		return nil, errors.New("docker client not initialized")
	}
	// AND the managed label so a same-server-id collision can never make us
	// start/stop/delete a container the daemon doesn't own.
	f := make(moby.Filters).Add("label", ManagedLabel+"=true")
	f.Add("label", ServerIDLabel+"="+id)
	res, err := c.api.ContainerList(ctx, moby.ContainerListOptions{All: true, Filters: f})
	if err != nil {
		return nil, fmt.Errorf("inspect by server id %s: %w", id, err)
	}
	if len(res.Items) == 0 {
		return nil, nil
	}
	cont := summaryToContainer(res.Items[0])
	return &cont, nil
}

func summaryToContainer(s container.Summary) Container {
	name := ""
	if len(s.Names) > 0 {
		name = strings.TrimPrefix(s.Names[0], "/")
	}
	return Container{
		ID:       s.ID,
		ServerID: s.Labels[ServerIDLabel],
		Kind:     s.Labels[KindLabel],
		Image:    s.Image,
		Name:     name,
		State:    string(s.State),
		Status:   s.Status,
		Labels:   s.Labels,
	}
}

// FollowLogs returns a multiplexed stdout/stderr stream that keeps streaming
// until ctx is cancelled or the container exits. `tail` bounds the historical
// preamble. The reader is in docker's framed multiplex format — demux with
// stdcopy before forwarding to clients.
func (c *Client) FollowLogs(
	ctx context.Context,
	containerID, tail string,
) (io.ReadCloser, error) {
	if c == nil || c.api == nil {
		return nil, errors.New("docker client not initialized")
	}
	res, err := c.api.ContainerLogs(ctx, containerID, moby.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Tail:       tail,
	})
	if err != nil {
		return nil, fmt.Errorf("logs %s: %w", containerID, err)
	}
	return res, nil
}

// StreamStats returns the streaming docker /stats body (~1 JSON sample/sec); the
// caller decodes it and forwards the relevant fields.
func (c *Client) StreamStats(
	ctx context.Context,
	containerID string,
) (io.ReadCloser, error) {
	if c == nil || c.api == nil {
		return nil, errors.New("docker client not initialized")
	}
	res, err := c.api.ContainerStats(ctx, containerID, moby.ContainerStatsOptions{
		Stream:                true,
		IncludePreviousSample: true,
	})
	if err != nil {
		return nil, fmt.Errorf("stats %s: %w", containerID, err)
	}
	return res.Body, nil
}

// SendCommand writes a line to the container's stdin, as if typed into the
// console. Requires the container to have been created with OpenStdin (servers
// are). We attach transiently and detach; closing our side doesn't close the
// container's stdin, so the process keeps accepting further commands.
func (c *Client) SendCommand(
	ctx context.Context,
	containerID, command string,
) error {
	if c == nil || c.api == nil {
		return errors.New("docker client not initialized")
	}
	res, err := c.api.ContainerAttach(ctx, containerID, moby.ContainerAttachOptions{
		Stream: true,
		Stdin:  true,
	})
	if err != nil {
		return fmt.Errorf("attach %s: %w", containerID, err)
	}
	defer res.Close()
	if _, err := res.Conn.Write([]byte(command + "\n")); err != nil {
		return fmt.Errorf("write command to %s: %w", containerID, err)
	}
	return nil
}

func envToSlice(env map[string]string) []string {
	if len(env) == 0 {
		return nil
	}
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

func trimDockerErr(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "docker: timed out contacting engine"
	}
	return err.Error()
}
