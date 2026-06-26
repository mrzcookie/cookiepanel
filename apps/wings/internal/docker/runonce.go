package docker

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	moby "github.com/moby/moby/client"
)

// RunSpec describes a short-lived helper container — today the egg install step:
// run an (untrusted) script once with the server's data volume mounted, bounded
// by resource + privilege limits, then capture its output and remove it.
type RunSpec struct {
	Image      string
	Entrypoint []string
	Cmd        []string
	Env        map[string]string
	Mounts     []RunMount
	// Extra labels merged onto the managed/job labels (e.g. the server id, so a
	// stale install container is identifiable).
	Labels map[string]string
	// Resource + privilege limits. Zero means "no limit". Install scripts set
	// these to bound an untrusted payload; NoNewPrivileges blocks setuid
	// escalation inside the container.
	MemoryMB        int
	NanoCPUs        int64
	PidsLimit       int
	NoNewPrivileges bool
	// Linux capabilities. Install jobs drop ["ALL"] then add back only the
	// file/process caps a typical install needs, so NET_RAW, SYS_ADMIN, etc. are
	// gone.
	CapDrop []string
	CapAdd  []string
	// Network, when set, is the only docker network the job joins (instead of the
	// default bridge). Empty = default bridge.
	Network string
}

// RunMount mounts a named docker volume into the helper container.
type RunMount struct {
	Volume   string
	Path     string
	ReadOnly bool
}

// RunResult is the outcome of a RunOnce.
type RunResult struct {
	ExitCode int
	Output   string // combined stdout+stderr, demuxed
}

// RunOnce creates, starts, waits for, captures the logs of, and removes a
// one-shot container. The image is pulled if missing. Returns the exit code +
// combined output; a non-zero exit is NOT an error (callers inspect ExitCode).
func (c *Client) RunOnce(ctx context.Context, spec RunSpec) (RunResult, error) {
	if c == nil || c.api == nil {
		return RunResult{}, errors.New("docker client not initialized")
	}
	if err := c.PullImage(ctx, spec.Image); err != nil {
		return RunResult{}, err
	}
	labels := map[string]string{ManagedLabel: "true", KindLabel: "job"}
	for k, v := range spec.Labels {
		labels[k] = v
	}
	cfg := &container.Config{
		Image:      spec.Image,
		Env:        envToSlice(spec.Env),
		Cmd:        spec.Cmd,
		Entrypoint: spec.Entrypoint,
		Labels:     labels,
	}
	host := &container.HostConfig{}
	for _, m := range spec.Mounts {
		host.Mounts = append(host.Mounts, mount.Mount{
			Type:     mount.TypeVolume,
			Source:   m.Volume,
			Target:   m.Path,
			ReadOnly: m.ReadOnly,
		})
	}
	if spec.MemoryMB > 0 {
		host.Memory = int64(spec.MemoryMB) * 1024 * 1024
	}
	if spec.PidsLimit > 0 {
		v := int64(spec.PidsLimit)
		host.PidsLimit = &v
	}
	if spec.NanoCPUs > 0 {
		host.NanoCPUs = spec.NanoCPUs
	}
	if spec.NoNewPrivileges {
		host.SecurityOpt = append(host.SecurityOpt, "no-new-privileges")
	}
	host.CapDrop = spec.CapDrop
	host.CapAdd = spec.CapAdd
	if spec.Network != "" {
		host.NetworkMode = container.NetworkMode(spec.Network)
	}
	created, err := c.api.ContainerCreate(ctx, moby.ContainerCreateOptions{
		Config:     cfg,
		HostConfig: host,
	})
	if err != nil {
		return RunResult{}, fmt.Errorf("create job container: %w", err)
	}
	id := created.ID
	// Always clean up the container, even on error paths.
	defer func() { _ = c.RemoveContainer(context.Background(), id, true) }()

	// Start first, THEN wait. Registering the wait before start is unsafe:
	// "not-running" is already true for a created-but-unstarted container, so the
	// wait can resolve instantly with exit 0 — and the deferred remove would then
	// kill the job mid-run. Waiting after start still catches a fast exit (docker
	// retains the exit status until the container is removed).
	if err := c.StartContainer(ctx, id); err != nil {
		return RunResult{}, err
	}
	waitRes := c.api.ContainerWait(ctx, id, moby.ContainerWaitOptions{
		Condition: container.WaitConditionNotRunning,
	})

	var exitCode int
	select {
	case <-ctx.Done():
		return RunResult{}, ctx.Err()
	case err := <-waitRes.Error:
		return RunResult{}, fmt.Errorf("wait job: %w", err)
	case resp := <-waitRes.Result:
		exitCode = int(resp.StatusCode)
	}

	out, err := c.containerOutput(ctx, id)
	if err != nil {
		return RunResult{ExitCode: exitCode}, err
	}
	return RunResult{ExitCode: exitCode, Output: out}, nil
}

func (c *Client) containerOutput(ctx context.Context, id string) (string, error) {
	rc, err := c.SnapshotLogs(ctx, id, "all")
	if err != nil {
		return "", err
	}
	defer rc.Close()
	var buf bytes.Buffer
	if _, err := stdcopy.StdCopy(&buf, &buf, rc); err != nil {
		return buf.String(), fmt.Errorf("read job logs: %w", err)
	}
	return strings.TrimRight(buf.String(), "\n"), nil
}
