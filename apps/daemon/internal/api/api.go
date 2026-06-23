// Package api implements the HTTPS API the panel dials into (panel → daemon).
// Auth is "Authorization: Bearer <node_key>" over TLS, the node key compared in
// constant time. The cert is self-signed and its fingerprint is pinned by the
// panel (see the tls package). A panic in any handler becomes a 500 — one bad
// request must never take the box's control plane down.
//
// The surface today covers system/stats, the server-container lifecycle, the
// console WebSocket, docker networks, the host firewall, and the sandboxed
// per-server file manager (list/read/write/mkdir/rename/delete, upload/download,
// URL-download jobs, and the recycle bin). Schedules and backups land in later
// slices.
package api

import (
	"context"
	"crypto/subtle"
	cryptotls "crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/cookiepanel/cookied/internal/docker"
	"github.com/cookiepanel/cookied/internal/filesystem"
	"github.com/cookiepanel/cookied/internal/firewall"
	"github.com/cookiepanel/cookied/internal/network"
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
	networks      *network.Manager
	firewall      *firewall.Manager
	files         *filesystem.Manager

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
	DockerClient  *docker.Client      // may be nil if docker is unavailable
	Servers       *server.Manager     // server-container lifecycle
	Networks      *network.Manager    // docker network lifecycle
	Firewall      *firewall.Manager   // host firewall
	Files         *filesystem.Manager // per-server sandboxed file manager
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
		networks:      cfg.Networks,
		firewall:      cfg.Firewall,
		files:         cfg.Files,
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
	mux.HandleFunc("GET /api/v1/networks", s.handleListNetworks)
	mux.HandleFunc("POST /api/v1/networks", s.handleCreateNetwork)
	mux.HandleFunc("DELETE /api/v1/networks/{id}", s.handleDeleteNetwork)
	mux.HandleFunc("POST /api/v1/networks/{id}/attach", s.handleAttachNetwork)
	mux.HandleFunc("POST /api/v1/networks/{id}/detach", s.handleDetachNetwork)
	mux.HandleFunc("GET /api/v1/firewall", s.handleFirewallStatus)
	mux.HandleFunc("POST /api/v1/firewall/open", s.handleFirewallOpen)
	mux.HandleFunc("POST /api/v1/firewall/close", s.handleFirewallClose)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/list", s.handleFilesList)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/read", s.handleFilesRead)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/write", s.handleFilesWrite)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/mkdir", s.handleFilesMkdir)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/rename", s.handleFilesRename)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/delete", s.handleFilesDelete)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/download", s.handleFilesDownload)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/upload", s.handleFilesUpload)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/url-download", s.handleFilesURLDownload)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/url-download/{jobId}", s.handleFilesURLDownloadStatus)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/archive", s.handleFilesArchive)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/extract", s.handleFilesExtract)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/trash", s.handleTrashList)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/restore", s.handleTrashRestore)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/delete", s.handleTrashDelete)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/empty", s.handleTrashEmpty)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/purge", s.handleTrashPurge)
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

// ─── networks ────────────────────────────────────────────────────────────────

func (s *Server) handleListNetworks(w http.ResponseWriter, r *http.Request) {
	list, err := s.networks.List(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if list == nil {
		list = []network.Network{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateNetwork(w http.ResponseWriter, r *http.Request) {
	var req network.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	nw, err := s.networks.Create(r.Context(), req)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, nw)
}

func (s *Server) handleDeleteNetwork(w http.ResponseWriter, r *http.Request) {
	if err := s.networks.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAttachNetwork(w http.ResponseWriter, r *http.Request) {
	s.networkAttach(w, r, s.networks.Attach)
}

func (s *Server) handleDetachNetwork(w http.ResponseWriter, r *http.Request) {
	s.networkAttach(w, r, s.networks.Detach)
}

func (s *Server) networkAttach(
	w http.ResponseWriter,
	r *http.Request,
	op func(ctx context.Context, networkID, serverID string) error,
) {
	var req network.AttachRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := op(r.Context(), r.PathValue("id"), req.ServerID); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── firewall ────────────────────────────────────────────────────────────────

func (s *Server) handleFirewallStatus(w http.ResponseWriter, r *http.Request) {
	st, err := s.firewall.Status(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleFirewallOpen(w http.ResponseWriter, r *http.Request) {
	s.firewallMutate(w, r, s.firewall.Open)
}

func (s *Server) handleFirewallClose(w http.ResponseWriter, r *http.Request) {
	s.firewallMutate(w, r, s.firewall.Close)
}

func (s *Server) firewallMutate(
	w http.ResponseWriter,
	r *http.Request,
	op func(ctx context.Context, rule firewall.Rule) error,
) {
	var rule firewall.Rule
	if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := op(r.Context(), rule); err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, firewall.ErrUnsupported) {
			status = http.StatusNotImplemented
		}
		writeJSONError(w, status, err)
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

// ─── files ───────────────────────────────────────────────────────────────────
//
// All routes are scoped to a server id (the path segment); the file manager
// sandboxes every operation to that server's data volume. writeFilesErr maps the
// package's sentinel errors onto HTTP status codes.

func (s *Server) handleFilesList(w http.ResponseWriter, r *http.Request) {
	entries, err := s.files.List(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	if entries == nil {
		entries = []filesystem.Entry{}
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) handleFilesRead(w http.ResponseWriter, r *http.Request) {
	content, err := s.files.Read(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": string(content)})
}

func (s *Server) handleFilesWrite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Write(r.Context(), r.PathValue("id"), body.Path, []byte(body.Content)); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFilesMkdir(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Mkdir(r.Context(), r.PathValue("id"), body.Path); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleFilesRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Rename(r.Context(), r.PathValue("id"), body.From, body.To); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleFilesDelete moves the target into the server's recycle bin rather than
// erasing it. Permanent removal happens from the bin (handleTrashDelete /
// handleTrashEmpty) or via the scheduled auto-purge.
func (s *Server) handleFilesDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Trash(r.Context(), r.PathValue("id"), body.Path); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleFilesDownload streams a file's bytes as application/octet-stream with a
// Content-Disposition: attachment so the panel/browser saves it. Lstat's size
// gives Content-Length (a real progress bar).
func (s *Server) handleFilesDownload(w http.ResponseWriter, r *http.Request) {
	f, info, err := s.files.Open(r.Context(), r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	defer f.Close()
	name := info.Name()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	// RFC 5987 encoding for the filename keeps non-ASCII names safe.
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`,
			strings.ReplaceAll(name, `"`, ``),
			url.PathEscape(name)))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, f)
}

// handleFilesUpload writes the raw request body to the target path. No
// multipart; the panel passes the file's bytes through as the request body. The
// atomic tmp+rename happens inside WriteStream.
func (s *Server) handleFilesUpload(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()
	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("missing ?path"))
		return
	}
	if err := s.files.WriteStream(r.Context(), r.PathValue("id"), path, r.Body); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleFilesURLDownload kicks off an async URL pull and returns its job id. The
// fetch runs in a background goroutine owned by filesystem.Jobs; the panel polls
// handleFilesURLDownloadStatus for progress.
func (s *Server) handleFilesURLDownload(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		URL  string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	id, err := s.files.Jobs().Start(s.files, r.PathValue("id"), body.Path, body.URL)
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": id})
}

// handleFilesURLDownloadStatus returns the current snapshot of one job.
func (s *Server) handleFilesURLDownloadStatus(w http.ResponseWriter, r *http.Request) {
	job, ok := s.files.Jobs().Get(r.PathValue("jobId"))
	if !ok {
		writeJSONError(w, http.StatusNotFound, fmt.Errorf("job not found"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) handleTrashList(w http.ResponseWriter, r *http.Request) {
	entries, err := s.files.ListTrash(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	if entries == nil {
		entries = []filesystem.TrashEntry{}
	}
	writeJSON(w, http.StatusOK, entries)
}

func (s *Server) handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.RestoreTrash(r.Context(), r.PathValue("id"), body.ID); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTrashDelete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.DeleteTrash(r.Context(), r.PathValue("id"), body.ID); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTrashEmpty(w http.ResponseWriter, r *http.Request) {
	if err := s.files.EmptyTrash(r.Context(), r.PathValue("id")); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleTrashPurge removes bin entries older than maxAgeSeconds. Called by the
// panel's scheduled auto-purge with each server's configured retention.
func (s *Server) handleTrashPurge(w http.ResponseWriter, r *http.Request) {
	var body struct {
		MaxAgeSeconds int64 `json:"maxAgeSeconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	purged, err := s.files.PurgeTrashOlderThan(
		r.Context(), r.PathValue("id"), time.Duration(body.MaxAgeSeconds)*time.Second,
	)
	if err != nil {
		s.writeFilesErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"purged": purged})
}

// handleFilesArchive packs paths into a new archive (zip / tar.gz / tar.xz /
// tar.bz2 / tar.zst) at dest, inside the server's data volume.
func (s *Server) handleFilesArchive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Paths  []string `json:"paths"`
		Dest   string   `json:"dest"`
		Format string   `json:"format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Archive(
		r.Context(), r.PathValue("id"), body.Paths, body.Dest, body.Format,
	); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleFilesExtract unpacks an archive (format auto-detected: zip / tar(.gz/
// .bz2/.xz/.zst) / 7z / rar / …) into dest, inside the server's data volume.
func (s *Server) handleFilesExtract(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Dest string `json:"dest"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.files.Extract(
		r.Context(), r.PathValue("id"), body.Path, body.Dest,
	); err != nil {
		s.writeFilesErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeFilesErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, filesystem.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err)
	case errors.Is(err, filesystem.ErrTraversal):
		writeJSONError(w, http.StatusBadRequest, err)
	case errors.Is(err, filesystem.ErrTooLarge):
		writeJSONError(w, http.StatusRequestEntityTooLarge, err)
	case errors.Is(err, filesystem.ErrDockerUnavailable):
		writeJSONError(w, http.StatusServiceUnavailable, err)
	default:
		writeJSONError(w, http.StatusBadRequest, err)
	}
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
