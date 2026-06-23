// Package api implements the HTTPS API the panel dials into (panel → daemon).
// Auth is "Authorization: Bearer <node_key>" over TLS, the node key compared in
// constant time. The cert is self-signed and its fingerprint is pinned by the
// panel (see the tls package). A panic in any handler becomes a 500 — one bad
// request must never take the box's control plane down.
//
// This slice exposes the read surface:
//
//	GET /api/v1/system        daemon version + uptime + system/docker info
//	GET /api/v1/system/host   host details (hostname, kernel, CPU model, …)
//	GET /api/v1/system/stats  live CPU%, memory/disk used, load average
//
// Servers, networks, firewall, files, schedules, and backups land in later slices.
package api

import (
	"context"
	"crypto/subtle"
	cryptotls "crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/cookiepanel/cookied/internal/docker"
	"github.com/cookiepanel/cookied/internal/server"
	"github.com/cookiepanel/cookied/internal/system"
	cookietls "github.com/cookiepanel/cookied/internal/tls"
	"github.com/cookiepanel/cookied/internal/version"
)

// Server is the panel-facing HTTPS server.
type Server struct {
	addr          string
	nodeKey       string
	nodeID        string
	signingSecret string
	staticInfo    map[string]any
	startedAt     time.Time
	tls           *cookietls.Material
	dockerClient  *docker.Client
	servers       *server.Manager

	server   *http.Server
	listener net.Listener
}

// Config bundles the dependencies needed to construct a Server.
type Config struct {
	Addr          string         // e.g. ":8443"
	NodeKey       string         // plaintext node key (the bearer)
	NodeID        string         // reported in /system + checked on the console JWT
	SigningSecret string         // per-node HS256 secret for the browser console JWT
	StaticInfo    map[string]any // os/arch/cpus/mem/disk/daemonVersion
	StartedAt     time.Time
	TLS           *cookietls.Material
	DockerClient  *docker.Client  // may be nil if docker is unavailable
	Servers       *server.Manager // server-container lifecycle
}

// New constructs but does not start the server.
func New(cfg Config) *Server {
	return &Server{
		addr:          cfg.Addr,
		nodeKey:       cfg.NodeKey,
		nodeID:        cfg.NodeID,
		signingSecret: cfg.SigningSecret,
		staticInfo:    cfg.StaticInfo,
		startedAt:     cfg.StartedAt,
		tls:           cfg.TLS,
		dockerClient:  cfg.DockerClient,
		servers:       cfg.Servers,
	}
}

// Start binds and serves HTTPS in a background goroutine. Returns once the
// listener is ready (or an error if binding fails).
func (s *Server) Start() error {
	if s.tls == nil {
		return errors.New("api: tls material is required")
	}
	if s.nodeKey == "" {
		return errors.New("api: node key is required")
	}
	ln, err := cryptotls.Listen("tcp", s.addr, s.tls.ServerTLSConfig())
	if err != nil {
		return fmt.Errorf("api: listen %s: %w", s.addr, err)
	}
	s.listener = ln
	s.server = &http.Server{
		Handler:           s.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := s.server.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("api serve failed", "err", err)
		}
	}()
	return nil
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *Server) routes() http.Handler {
	// The console WS authenticates via a JWT query param (browsers can't set the
	// Authorization header on a WS upgrade), so it sits OUTSIDE the bearer
	// middleware, registered bare on the outer mux.
	outer := http.NewServeMux()
	outer.HandleFunc("GET /api/servers/{id}/ws", s.handleServerWS)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/system", s.handleSystem)
	mux.HandleFunc("GET /api/v1/system/host", s.handleSystemHost)
	mux.HandleFunc("GET /api/v1/system/stats", s.handleSystemStats)
	mux.HandleFunc("GET /api/v1/servers", s.handleListServers)
	mux.HandleFunc("POST /api/v1/servers", s.handleCreateServer)
	mux.HandleFunc("GET /api/v1/servers/{id}", s.handleGetServer)
	mux.HandleFunc("DELETE /api/v1/servers/{id}", s.handleDeleteServer)
	mux.HandleFunc("POST /api/v1/servers/{id}/start", s.handleStartServer)
	mux.HandleFunc("POST /api/v1/servers/{id}/stop", s.handleStopServer)
	mux.HandleFunc("POST /api/v1/servers/{id}/restart", s.handleRestartServer)
	mux.HandleFunc("POST /api/v1/servers/{id}/command", s.handleServerCommand)
	outer.Handle("/", recoverPanic(s.bearerAuth(mux)))
	return outer
}

// recoverPanic turns a handler panic into a 500 instead of crashing the daemon —
// a single malformed request must never take the box's control plane down.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in handler", "path", r.URL.Path, "recover", rec)
				// Headers may already be partially written; best-effort.
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":"internal error"}`))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) bearerAuth(next http.Handler) http.Handler {
	expected := []byte(s.nodeKey)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hdr := r.Header.Get("Authorization")
		if !strings.HasPrefix(hdr, "Bearer ") {
			writeUnauthorized(w)
			return
		}
		got := []byte(strings.TrimSpace(hdr[len("Bearer "):]))
		if subtle.ConstantTimeCompare(got, expected) != 1 {
			writeUnauthorized(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// SystemResponse is the GET /api/v1/system payload.
type SystemResponse struct {
	NodeID          string         `json:"nodeId"`
	DaemonVersion   string         `json:"daemonVersion"`
	DaemonStartedAt time.Time      `json:"daemonStartedAt"`
	UptimeSeconds   int64          `json:"uptimeSeconds"`
	System          map[string]any `json:"system"`
	Docker          docker.Info    `json:"docker"`
}

func (s *Server) handleSystem(w http.ResponseWriter, r *http.Request) {
	sys := make(map[string]any, len(s.staticInfo))
	for k, v := range s.staticInfo {
		sys[k] = v
	}
	probeCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, SystemResponse{
		NodeID:          s.nodeID,
		DaemonVersion:   version.Version,
		DaemonStartedAt: s.startedAt,
		UptimeSeconds:   int64(time.Since(s.startedAt).Seconds()),
		System:          sys,
		Docker:          s.dockerClient.Probe(probeCtx),
	})
}

// ─── servers ─────────────────────────────────────────────────────────────────

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

func (s *Server) handleCreateServer(w http.ResponseWriter, r *http.Request) {
	var req server.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	srv, err := s.servers.Create(r.Context(), req)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, srv)
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

func (s *Server) handleDeleteServer(w http.ResponseWriter, r *http.Request) {
	if err := s.servers.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleStartServer(w http.ResponseWriter, r *http.Request) {
	s.serverPower(w, r, s.servers.Start)
}

func (s *Server) handleStopServer(w http.ResponseWriter, r *http.Request) {
	s.serverPower(w, r, s.servers.Stop)
}

func (s *Server) handleRestartServer(w http.ResponseWriter, r *http.Request) {
	s.serverPower(w, r, s.servers.Restart)
}

func (s *Server) serverPower(
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

func (s *Server) handleServerCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.servers.SendCommand(r.Context(), r.PathValue("id"), body.Command); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSystemHost(w http.ResponseWriter, r *http.Request) {
	info, err := system.GatherInfo(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleSystemStats(w http.ResponseWriter, r *http.Request) {
	stats, err := system.GatherStats(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeJSONError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
}
