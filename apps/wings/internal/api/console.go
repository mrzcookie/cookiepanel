package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/moby/moby/api/pkg/stdcopy"
	cstats "github.com/moby/moby/api/types/container"

	"github.com/xena-studios/raptor/apps/wings/internal/safe"
)

// ConsoleFrame is one console event the daemon streams to the panel (which
// relays it to the browser over its own WebSocket): a log line or a
// resource-stats sample. Shape:
//
//	{ "kind": "log",   "stream": "stdout"|"stderr", "data": "..." }
//	{ "kind": "stats", "cpuPct": 1.2, "memBytes": 12345, "memLimit": 67890 }
type ConsoleFrame struct {
	Kind     string   `json:"kind"`
	Stream   string   `json:"stream,omitempty"`
	Data     string   `json:"data,omitempty"`
	CPUPct   *float64 `json:"cpuPct,omitempty"`
	MemBytes *uint64  `json:"memBytes,omitempty"`
	MemLimit *uint64  `json:"memLimit,omitempty"`
	Message  string   `json:"message,omitempty"`
}

// StreamConsole follows a server container's logs + resource stats, emitting one
// ConsoleFrame per log line / stats sample until ctx is cancelled or a stream
// ends. The transport supplies `emit` — the panel link wraps each frame as a
// `chunk` over the daemon's WebSocket. Returns nil on a clean end.
func (s *Server) StreamConsole(
	ctx context.Context,
	serverID string,
	emit func(ConsoleFrame) error,
) error {
	c, err := s.dockerClient.InspectByServerID(ctx, serverID)
	if err != nil || c == nil {
		return fmt.Errorf("no container for server %s", serverID)
	}
	return streamServerSession(ctx, s, c.ID, emit)
}

// streamServerSession runs the two docker readers concurrently and forwards each
// frame via emit. Returns when ctx is cancelled or either stream errors.
func streamServerSession(
	ctx context.Context,
	s *Server,
	containerID string,
	emit func(ConsoleFrame) error,
) error {
	logs, err := s.dockerClient.FollowLogs(ctx, containerID, "200")
	if err != nil {
		return err
	}
	defer logs.Close()

	stats, err := s.dockerClient.StreamStats(ctx, containerID)
	if err != nil {
		return err
	}
	defer stats.Close()

	errCh := make(chan error, 2)
	go func() {
		errCh <- safe.Guard("console:pumpLogs", func() error { return pumpLogs(ctx, emit, logs) })
	}()
	go func() {
		errCh <- safe.Guard("console:pumpStats", func() error { return pumpStats(ctx, emit, stats) })
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

// pumpLogs demuxes docker's framed stdout/stderr stream and emits one frame per
// line.
func pumpLogs(ctx context.Context, emit func(ConsoleFrame) error, src io.Reader) error {
	stdout := newLineForwarder(ctx, emit, "stdout")
	stderr := newLineForwarder(ctx, emit, "stderr")
	defer stdout.flush()
	defer stderr.flush()
	if _, err := stdcopy.StdCopy(stdout, stderr, src); err != nil &&
		!errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// lineForwarder buffers bytes from one docker substream and emits one frame per
// newline. On flush (EOF/close) any tail is sent as a partial line.
type lineForwarder struct {
	emit   func(ConsoleFrame) error
	stream string
	pipe   *io.PipeWriter
	done   chan struct{}
}

func newLineForwarder(
	ctx context.Context,
	emit func(ConsoleFrame) error,
	stream string,
) *lineForwarder {
	pr, pw := io.Pipe()
	lf := &lineForwarder{emit: emit, stream: stream, pipe: pw, done: make(chan struct{})}
	go func() {
		defer safe.Recover("console:lineForwarder")
		defer close(lf.done)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if ctx.Err() != nil {
				return
			}
			if err := emit(ConsoleFrame{Kind: "log", Stream: stream, Data: sc.Text()}); err != nil {
				return
			}
		}
	}()
	return lf
}

func (l *lineForwarder) Write(p []byte) (int, error) {
	return l.pipe.Write(p)
}

func (l *lineForwarder) flush() {
	_ = l.pipe.Close()
	<-l.done
}

// pumpStats decodes the streaming /stats JSON body and emits one summary frame
// per sample (docker's `docker stats` CPU% formula).
func pumpStats(ctx context.Context, emit func(ConsoleFrame) error, src io.Reader) error {
	dec := json.NewDecoder(src)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var sample cstats.StatsResponse
		if err := dec.Decode(&sample); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		cpu := cpuPercent(&sample)
		mem := sample.MemoryStats.Usage
		limit := sample.MemoryStats.Limit
		if err := emit(ConsoleFrame{
			Kind:     "stats",
			CPUPct:   &cpu,
			MemBytes: &mem,
			MemLimit: &limit,
		}); err != nil {
			return err
		}
	}
}

// cpuPercent matches docker's `docker stats` formula. Returns 0 when the
// previous-sample data is missing.
func cpuPercent(s *cstats.StatsResponse) float64 {
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) -
		float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) -
		float64(s.PreCPUStats.SystemUsage)
	if cpuDelta <= 0 || sysDelta <= 0 {
		return 0
	}
	cpus := float64(s.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpus == 0 {
		cpus = 1
	}
	return (cpuDelta / sysDelta) * cpus * 100.0
}
