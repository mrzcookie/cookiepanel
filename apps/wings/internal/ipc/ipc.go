// Package ipc serves the daemon's box-local control plane over a root-only Unix
// socket, so an operator can manage the box (status, list/start/stop/delete
// servers, tail logs) straight from the machine — via the `wings tui`/`status`
// commands — even when the panel is unreachable. It is deliberately separate from
// the panel-facing HTTPS API: no node key, no TLS; the only gate is the socket's
// filesystem permissions (0600, root-only). It reuses the same store + server
// manager + docker client the API does, so both see one consistent box state.
package ipc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/moby/moby/api/pkg/stdcopy"

	"github.com/xena-studios/raptor/apps/wings/internal/docker"
	"github.com/xena-studios/raptor/apps/wings/internal/server"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
)

// DefaultSocket is where the control socket lives on a managed box.
const DefaultSocket = "/run/wings.sock"

// socketPerm keeps the socket root-only (owner read/write). The daemon runs as
// root, so the owner is root and nothing unprivileged can connect.
const socketPerm = 0o600

// Server serves the local control API over a Unix socket.
type Server struct {
	socketPath string
	store      *store.Store
	servers    *server.Manager
	docker     *docker.Client

	listener net.Listener
	server   *http.Server
}

// Config bundles the dependencies the IPC server shares with the rest of the box.
type Config struct {
	SocketPath string
	Store      *store.Store
	Servers    *server.Manager
	Docker     *docker.Client
}

// New constructs but does not start the server.
func New(cfg Config) *Server {
	return &Server{
		socketPath: cfg.SocketPath,
		store:      cfg.Store,
		servers:    cfg.Servers,
		docker:     cfg.Docker,
	}
}

// Start binds the Unix socket and serves in a background goroutine.
func (s *Server) Start() error {
	if err := os.MkdirAll(filepath.Dir(s.socketPath), 0o755); err != nil {
		return fmt.Errorf("ipc: socket dir: %w", err)
	}
	if err := removeStaleSocket(s.socketPath); err != nil {
		return err
	}
	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("ipc: listen %s: %w", s.socketPath, err)
	}
	if err := os.Chmod(s.socketPath, socketPerm); err != nil {
		_ = ln.Close()
		return fmt.Errorf("ipc: chmod socket: %w", err)
	}
	s.listener = ln
	s.server = &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := s.server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("ipc serve failed", "err", err)
		}
	}()
	return nil
}

// Shutdown gracefully stops the server and removes the socket file.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.server != nil {
		_ = s.server.Shutdown(ctx)
	}
	_ = os.Remove(s.socketPath)
	return nil
}

// removeStaleSocket clears a leftover socket from a previous run. If something is
// still listening on it, another daemon owns the box — that's an error, not a
// stale file to clobber.
func removeStaleSocket(path string) error {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("ipc: stat socket: %w", err)
	}
	if info.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("ipc: %s exists and is not a socket", path)
	}
	if conn, derr := net.DialTimeout("unix", path, 200*time.Millisecond); derr == nil {
		_ = conn.Close()
		return fmt.Errorf("ipc: another daemon is already listening on %s", path)
	}
	return os.Remove(path)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/ping", s.handlePing)
	mux.HandleFunc("GET /v1/status", s.handleStatus)
	mux.HandleFunc("GET /v1/servers", s.handleListServers)
	mux.HandleFunc("GET /v1/servers/{id}", s.handleGetServer)
	mux.HandleFunc("POST /v1/servers/{id}/start", s.handleStartServer)
	mux.HandleFunc("POST /v1/servers/{id}/stop", s.handleStopServer)
	mux.HandleFunc("DELETE /v1/servers/{id}", s.handleDeleteServer)
	mux.HandleFunc("GET /v1/servers/{id}/logs", s.handleServerLogs)
	return mux
}

func (s *Server) handlePing(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	st, _, err := s.store.GetStatus()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleListServers(w http.ResponseWriter, r *http.Request) {
	list, err := s.servers.List(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if list == nil {
		list = []server.Server{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetServer(w http.ResponseWriter, r *http.Request) {
	srv, err := s.servers.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if srv == nil {
		writeJSONError(w, http.StatusNotFound, errors.New("no such server"))
		return
	}
	writeJSON(w, http.StatusOK, srv)
}

func (s *Server) handleStartServer(w http.ResponseWriter, r *http.Request) {
	s.power(w, r, s.servers.Start)
}

func (s *Server) handleStopServer(w http.ResponseWriter, r *http.Request) {
	s.power(w, r, s.servers.Stop)
}

func (s *Server) power(
	w http.ResponseWriter,
	r *http.Request,
	op func(context.Context, string) (*server.Server, error),
) {
	srv, err := op(r.Context(), r.PathValue("id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, srv)
}

func (s *Server) handleDeleteServer(w http.ResponseWriter, r *http.Request) {
	if err := s.servers.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleServerLogs returns the tail of a server's container logs as plain text,
// demuxed from docker's framed stdout/stderr stream.
func (s *Server) handleServerLogs(w http.ResponseWriter, r *http.Request) {
	tail := r.URL.Query().Get("tail")
	if tail == "" {
		tail = "200"
	}
	srv, err := s.servers.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if srv == nil || srv.ContainerID == "" {
		writeJSONError(w, http.StatusNotFound, errors.New("server has no container"))
		return
	}
	raw, err := s.docker.SnapshotLogs(r.Context(), srv.ContainerID, tail)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	defer raw.Close()
	var buf bytes.Buffer
	if _, err := stdcopy.StdCopy(&buf, &buf, raw); err != nil && !errors.Is(err, io.EOF) {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
