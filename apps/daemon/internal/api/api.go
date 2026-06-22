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

	"github.com/cookiepanel/cookied/internal/system"
	cookietls "github.com/cookiepanel/cookied/internal/tls"
	"github.com/cookiepanel/cookied/internal/version"
)

// Server is the panel-facing HTTPS server.
type Server struct {
	addr       string
	nodeKey    string
	nodeID     string
	staticInfo map[string]any
	startedAt  time.Time
	tls        *cookietls.Material

	server   *http.Server
	listener net.Listener
}

// Config bundles the dependencies needed to construct a Server.
type Config struct {
	Addr       string         // e.g. ":8443"
	NodeKey    string         // plaintext node key (the bearer)
	NodeID     string         // reported in the /system response
	StaticInfo map[string]any // os/arch/cpus/mem/disk/daemonVersion
	StartedAt  time.Time
	TLS        *cookietls.Material
}

// New constructs but does not start the server.
func New(cfg Config) *Server {
	return &Server{
		addr:       cfg.Addr,
		nodeKey:    cfg.NodeKey,
		nodeID:     cfg.NodeID,
		staticInfo: cfg.StaticInfo,
		startedAt:  cfg.StartedAt,
		tls:        cfg.TLS,
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
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/system", s.handleSystem)
	mux.HandleFunc("GET /api/v1/system/host", s.handleSystemHost)
	mux.HandleFunc("GET /api/v1/system/stats", s.handleSystemStats)
	return recoverPanic(s.bearerAuth(mux))
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
	Docker          map[string]any `json:"docker"`
}

func (s *Server) handleSystem(w http.ResponseWriter, _ *http.Request) {
	sys := make(map[string]any, len(s.staticInfo))
	for k, v := range s.staticInfo {
		sys[k] = v
	}
	writeJSON(w, http.StatusOK, SystemResponse{
		NodeID:          s.nodeID,
		DaemonVersion:   version.Version,
		DaemonStartedAt: s.startedAt,
		UptimeSeconds:   int64(time.Since(s.startedAt).Seconds()),
		System:          sys,
		// The Docker subsystem lands in a later slice; report it absent until then.
		Docker: map[string]any{"available": false},
	})
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
