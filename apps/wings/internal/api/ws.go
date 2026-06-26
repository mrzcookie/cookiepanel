package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/moby/moby/api/pkg/stdcopy"
	cstats "github.com/moby/moby/api/types/container"

	"github.com/xena-studios/raptorpanel/apps/wings/internal/auth"
	"github.com/xena-studios/raptorpanel/apps/wings/internal/safe"
)

// JWT-authed browser console gateway. One WS at /api/servers/{id}/ws emits typed
// JSON frames so the panel multiplexes live logs + stats over a single socket:
//
//	{ "kind": "log",   "stream": "stdout"|"stderr", "data": "..." }
//	{ "kind": "stats", "cpuPct": 1.2, "memBytes": 12345, "memLimit": 67890 }
//	{ "kind": "error", "message": "..." }   (the daemon is closing the socket)
//
// The panel signs the JWT with the per-node signing secret; the daemon verifies
// locally so each frame costs no panel round-trip.

type wsFrame struct {
	Kind     string   `json:"kind"`
	Stream   string   `json:"stream,omitempty"`
	Data     string   `json:"data,omitempty"`
	CPUPct   *float64 `json:"cpuPct,omitempty"`
	MemBytes *uint64  `json:"memBytes,omitempty"`
	MemLimit *uint64  `json:"memLimit,omitempty"`
	Message  string   `json:"message,omitempty"`
}

func (s *Server) handleServerWS(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}
	claims, err := auth.VerifyBrowserToken(token, s.signingSecret)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	if claims.ServerID != id {
		http.Error(w, "token does not match this server", http.StatusForbidden)
		return
	}
	// Defense in depth: the token must be addressed to *this* node. Each node has
	// a distinct signing secret so a foreign token won't verify anyway, but this
	// guards against any future secret-sharing / copy-paste misconfig.
	if s.nodeID != "" && claims.NodeID != s.nodeID {
		http.Error(w, "token not issued for this node", http.StatusForbidden)
		return
	}

	c, err := s.dockerClient.InspectByServerID(r.Context(), id)
	if err != nil || c == nil {
		http.Error(w, "no container for server", http.StatusNotFound)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// The panel's domain isn't known to the daemon at compile time, and the
		// JWT signature is the real auth, so any Origin is allowed.
		InsecureSkipVerify: true,
	})
	if err != nil {
		slog.Warn("ws accept failed", "err", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "")

	// Detach from r.Context so closing the request body (which the WS uses
	// internally) doesn't immediately cancel the docker streams; cancel when the
	// peer goes away.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		<-r.Context().Done()
		cancel()
	}()

	if err := s.streamServerSession(ctx, conn, c.ID); err != nil &&
		!errors.Is(err, context.Canceled) {
		_ = wsjson.Write(ctx, conn, wsFrame{Kind: "error", Message: err.Error()})
	}
}

// streamServerSession runs the two docker readers concurrently and forwards each
// frame to conn. Returns when ctx is cancelled or either stream errors.
func (s *Server) streamServerSession(
	ctx context.Context,
	conn *websocket.Conn,
	containerID string,
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
		errCh <- safe.Guard("ws:pumpLogs", func() error { return s.pumpLogs(ctx, conn, logs) })
	}()
	go func() {
		errCh <- safe.Guard("ws:pumpStats", func() error { return s.pumpStats(ctx, conn, stats) })
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

// pumpLogs demuxes docker's framed stdout/stderr stream and forwards each line
// as a typed frame.
func (s *Server) pumpLogs(
	ctx context.Context,
	conn *websocket.Conn,
	src io.Reader,
) error {
	stdout := newLineForwarder(ctx, conn, "stdout")
	stderr := newLineForwarder(ctx, conn, "stderr")
	defer stdout.flush()
	defer stderr.flush()
	if _, err := stdcopy.StdCopy(stdout, stderr, src); err != nil &&
		!errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

// lineForwarder buffers bytes from one docker substream and sends one wsFrame per
// newline. On flush (EOF/close) any tail is sent as a partial line.
type lineForwarder struct {
	conn   *websocket.Conn
	stream string
	pipe   *io.PipeWriter
	done   chan struct{}
}

func newLineForwarder(
	ctx context.Context,
	conn *websocket.Conn,
	stream string,
) *lineForwarder {
	pr, pw := io.Pipe()
	lf := &lineForwarder{
		conn:   conn,
		stream: stream,
		pipe:   pw,
		done:   make(chan struct{}),
	}
	go func() {
		defer safe.Recover("ws:lineForwarder")
		defer close(lf.done)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			if err := wsjson.Write(ctx, conn, wsFrame{
				Kind:   "log",
				Stream: stream,
				Data:   sc.Text(),
			}); err != nil {
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
func (s *Server) pumpStats(
	ctx context.Context,
	conn *websocket.Conn,
	src io.Reader,
) error {
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
		if err := wsjson.Write(ctx, conn, wsFrame{
			Kind:     "stats",
			CPUPct:   &cpu,
			MemBytes: &mem,
			MemLimit: &limit,
		}); err != nil {
			return err
		}
		// No throttle needed: docker's stats stream is the pacer (~1 sample/sec),
		// and Decode above blocks until the next one. ctx cancellation unblocks it
		// via the stream closing.
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
