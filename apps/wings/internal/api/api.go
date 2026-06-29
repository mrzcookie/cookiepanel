// Package api implements the HTTPS API the panel dials into (panel → daemon).
// Auth is "Authorization: Bearer <node_key>" over TLS, the node key compared in
// constant time. The cert is self-signed and its fingerprint is pinned by the
// panel (see the tls package). A panic in any handler becomes a 500 — one bad
// request must never take the box's control plane down.
//
// The surface today covers system/stats, the server-container lifecycle, the
// console WebSocket, docker networks, the host firewall, the sandboxed per-server
// file manager (list/read/write/mkdir/rename/delete, upload/download, archive,
// URL-download jobs, the recycle bin), SFTP sessions, server-automation
// schedules, borg backups, host maintenance (reboot, prune, daemon restart +
// self-update), and physical-drive management.
package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xena-studios/raptor/apps/wings/internal/backup"
	"github.com/xena-studios/raptor/apps/wings/internal/docker"
	"github.com/xena-studios/raptor/apps/wings/internal/drive"
	"github.com/xena-studios/raptor/apps/wings/internal/filesystem"
	"github.com/xena-studios/raptor/apps/wings/internal/firewall"
	"github.com/xena-studios/raptor/apps/wings/internal/logging"
	"github.com/xena-studios/raptor/apps/wings/internal/mongobrowser"
	"github.com/xena-studios/raptor/apps/wings/internal/network"
	"github.com/xena-studios/raptor/apps/wings/internal/redisbrowser"
	"github.com/xena-studios/raptor/apps/wings/internal/scheduler"
	"github.com/xena-studios/raptor/apps/wings/internal/server"
	"github.com/xena-studios/raptor/apps/wings/internal/sftp"
	"github.com/xena-studios/raptor/apps/wings/internal/sqlbrowser"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
	"github.com/xena-studios/raptor/apps/wings/internal/system"
	"github.com/xena-studios/raptor/apps/wings/internal/version"
)

// Server holds the panel-facing API handlers. It no longer binds an inbound
// listener: the daemon dials OUT to the panel (see internal/link), and the link
// dispatches control requests into Handler() in process. The bearer middleware
// still wraps every route (the link sets the node key on each synthetic request).
type Server struct {
	nodeKey      string
	nodeID       string
	staticInfo   map[string]any
	startedAt    time.Time
	dockerClient *docker.Client
	servers      *server.Manager
	networks     *network.Manager
	firewall     *firewall.Manager
	files        *filesystem.Manager
	sftp         *sftp.Manager
	scheduler    *scheduler.Scheduler
	backups      *backup.Manager
	drives       *drive.Manager
}

// Config bundles the dependencies needed to construct a Server.
type Config struct {
	NodeKey      string               // plaintext node key (the bearer)
	NodeID       string               // reported in /system, stamped on logs
	StaticInfo   map[string]any       // os/arch/cpus/mem/disk/daemonVersion
	StartedAt    time.Time            //
	DockerClient *docker.Client       // may be nil if docker is unavailable
	Servers      *server.Manager      // server-container lifecycle
	Networks     *network.Manager     // docker network lifecycle
	Firewall     *firewall.Manager    // host firewall
	Files        *filesystem.Manager  // per-server sandboxed file manager
	SFTP         *sftp.Manager        // SFTP session mint/revoke
	Scheduler    *scheduler.Scheduler // server automations (cron)
	Backups      *backup.Manager      // borg snapshot/restore
	Drives       *drive.Manager       // physical-disk management
}

// New constructs the API handler set.
func New(cfg Config) *Server {
	return &Server{
		nodeKey:      cfg.NodeKey,
		nodeID:       cfg.NodeID,
		staticInfo:   cfg.StaticInfo,
		startedAt:    cfg.StartedAt,
		dockerClient: cfg.DockerClient,
		servers:      cfg.Servers,
		networks:     cfg.Networks,
		firewall:     cfg.Firewall,
		files:        cfg.Files,
		sftp:         cfg.SFTP,
		scheduler:    cfg.Scheduler,
		backups:      cfg.Backups,
		drives:       cfg.Drives,
	}
}

// Handler returns the panel-facing HTTP handler (routing + middleware). The
// outbound WebSocket link (internal/link) dispatches requests into it in
// process — there is no inbound listener. The bearer middleware still applies;
// the link sets the node key on each synthetic request.
func (s *Server) Handler() http.Handler {
	return s.routes()
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/system", s.handleSystem)
	mux.HandleFunc("GET /api/v1/system/host", s.handleSystemHost)
	mux.HandleFunc("GET /api/v1/system/stats", s.handleSystemStats)
	mux.HandleFunc("POST /api/v1/system/reboot", s.handleReboot)
	mux.HandleFunc("POST /api/v1/system/prune", s.handlePrune)
	mux.HandleFunc("POST /api/v1/system/restart-daemon", s.handleRestartDaemon)
	mux.HandleFunc("POST /api/v1/system/update-daemon", s.handleUpdateDaemon)
	mux.HandleFunc("GET /api/v1/drives", s.handleListDrives)
	mux.HandleFunc("POST /api/v1/drives/format", s.handleFormatDrive)
	mux.HandleFunc("POST /api/v1/drives/mount", s.handleMountDrive)
	mux.HandleFunc("POST /api/v1/drives/unmount", s.handleUnmountDrive)
	mux.HandleFunc("POST /api/v1/drives/data-target", s.handleSetDataTarget)
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
	mux.HandleFunc("GET /api/v1/servers/{id}/sftp", s.handleSftpStatus)
	mux.HandleFunc("POST /api/v1/servers/{id}/sftp", s.handleSftpMint)
	mux.HandleFunc("DELETE /api/v1/servers/{id}/sftp", s.handleSftpRevoke)
	mux.HandleFunc("GET /api/v1/schedules", s.handleListSchedules)
	mux.HandleFunc("POST /api/v1/schedules", s.handleUpsertSchedule)
	mux.HandleFunc("DELETE /api/v1/schedules/{id}", s.handleDeleteSchedule)
	mux.HandleFunc("POST /api/v1/schedules/{id}/run", s.handleRunSchedule)
	mux.HandleFunc("GET /api/v1/servers/{id}/backups", s.handleListBackups)
	mux.HandleFunc("POST /api/v1/servers/{id}/backups", s.handleCreateBackup)
	mux.HandleFunc("POST /api/v1/servers/{id}/backups/restore", s.handleRestoreBackup)
	mux.HandleFunc("POST /api/v1/servers/{id}/backups/{archive}/lock", s.handleLockBackup)
	mux.HandleFunc("DELETE /api/v1/servers/{id}/backups/{archive}", s.handleDeleteBackup)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/overview", s.handleRedisOverview)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/keys", s.handleRedisKeys)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/key", s.handleRedisKey)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/set", s.handleRedisSet)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/delete", s.handleRedisDelete)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/rename", s.handleRedisRename)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/ttl", s.handleRedisTTL)
	mux.HandleFunc("POST /api/v1/servers/{id}/redis/flush", s.handleRedisFlush)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/databases", s.handleMongoDatabases)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/collections", s.handleMongoCollections)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/documents", s.handleMongoDocuments)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/insert", s.handleMongoInsert)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/delete", s.handleMongoDelete)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/create-collection", s.handleMongoCreateCollection)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/drop-collection", s.handleMongoDropCollection)
	mux.HandleFunc("POST /api/v1/servers/{id}/mongo/drop-database", s.handleMongoDropDatabase)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/databases", s.handleSQLDatabases)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/create-database", s.handleSQLCreateDatabase)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/drop-database", s.handleSQLDropDatabase)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/tables", s.handleSQLTables)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/create-table", s.handleSQLCreateTable)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/drop-table", s.handleSQLDropTable)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/truncate-table", s.handleSQLTruncateTable)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/columns", s.handleSQLColumns)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/add-column", s.handleSQLAddColumn)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/drop-column", s.handleSQLDropColumn)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/users", s.handleSQLUsers)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/create-user", s.handleSQLCreateUser)
	mux.HandleFunc("POST /api/v1/servers/{id}/sql/drop-user", s.handleSQLDropUser)
	mux.HandleFunc("GET /api/v1/servers/{id}/files/trash", s.handleTrashList)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/restore", s.handleTrashRestore)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/delete", s.handleTrashDelete)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/empty", s.handleTrashEmpty)
	mux.HandleFunc("POST /api/v1/servers/{id}/files/trash/purge", s.handleTrashPurge)
	// Chain, outermost first: logRequests → recoverPanic → bearerAuth → mux. The
	// logger is outermost so the access log always records a completion line —
	// even when a handler panics, which recoverPanic converts to a correlated
	// 500. The logger never sees the bearer token (it isn't logged regardless —
	// see logRequests).
	return s.logRequests(recoverPanic(s.bearerAuth(mux)))
}

// RequestIDHeader correlates one logical request across the two halves: the
// panel stamps it on every daemon call, the daemon echoes it back and tags its
// access log with it. Absent, the daemon mints one.
const RequestIDHeader = "X-Raptor-Request-Id"

// statusRecorder captures the response status + byte count for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// logRequests is the access log + correlation middleware for the panel→daemon
// API. It mints/propagates a request id, binds it (plus the node id) to the
// request context so every line a handler logs correlates, and records one
// completion line whose level reflects the outcome: 5xx→error, 4xx→warn,
// success→debug (so failures are always visible and the per-request firehose is
// opt-in behind --debug). It logs NEITHER headers (the Authorization bearer is
// the node key) NOR bodies (they can carry secret variable values and image
// strings) — see security.md §2.
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get(RequestIDHeader)
		if reqID == "" {
			reqID = newRequestID()
		}
		w.Header().Set(RequestIDHeader, reqID)

		ctx := logging.WithAttrs(r.Context(),
			slog.String("request_id", reqID),
			slog.String("node_id", s.nodeID),
		)
		r = r.WithContext(ctx)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		slog.DebugContext(ctx, "api request started",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("remote", r.RemoteAddr),
		)
		next.ServeHTTP(rec, r)
		slog.LogAttrs(ctx, levelForStatus(rec.status), "api request completed",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", rec.status),
			slog.Duration("duration", time.Since(start)),
			slog.Int("bytes", rec.bytes),
		)
	})
}

// levelForStatus maps an HTTP status to a log level so server errors always
// surface (error), client errors are visible (warn), and routine success stays
// quiet (debug).
func levelForStatus(status int) slog.Level {
	switch {
	case status >= 500:
		return slog.LevelError
	case status >= 400:
		return slog.LevelWarn
	default:
		return slog.LevelDebug
	}
}

// newRequestID mints a short random hex id (crypto/rand, never math/rand) for
// calls that arrive without the panel's request-id header.
func newRequestID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// A crypto/rand failure is effectively impossible; fall back to a
		// timestamp so request logging can never block a request.
		return fmt.Sprintf("ts-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// recoverPanic turns a handler panic into a 500 instead of crashing the daemon —
// a single malformed request must never take the box's control plane down.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.ErrorContext(r.Context(), "panic in handler",
					"path", r.URL.Path, "recover", rec)
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

// ─── host maintenance ────────────────────────────────────────────────────────

func (s *Server) handleReboot(w http.ResponseWriter, r *http.Request) {
	if err := system.Reboot(r.Context()); err != nil {
		writeSystemErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "rebooting"})
}

// handlePrune frees disk by clearing dangling images + build cache. Never
// touches managed containers/volumes (see docker.Prune).
func (s *Server) handlePrune(w http.ResponseWriter, r *http.Request) {
	res, err := s.dockerClient.Prune(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleRestartDaemon(w http.ResponseWriter, r *http.Request) {
	if err := system.RestartDaemon(r.Context()); err != nil {
		writeSystemErr(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting"})
}

// handleUpdateDaemon downloads + verifies + swaps the daemon binary, then
// restarts after the response flushes so the new image boots. The download is
// detached from the request context (it can run minutes) and bounded at 10m; a
// failed download/verify surfaces as an error before the swap is announced.
func (s *Server) handleUpdateDaemon(w http.ResponseWriter, r *http.Request) {
	var body struct {
		URL    string `json:"url"`
		SHA256 string `json:"sha256"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	if err := system.UpdateDaemon(ctx, body.URL, body.SHA256); err != nil {
		cancel()
		writeSystemErr(w, err)
		return
	}
	go func() {
		defer cancel()
		time.Sleep(time.Second)
		_ = system.RestartDaemon(context.Background())
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "updating"})
}

func writeSystemErr(w http.ResponseWriter, err error) {
	if errors.Is(err, system.ErrUnsupported) {
		writeJSONError(w, http.StatusNotImplemented, err)
		return
	}
	writeJSONError(w, http.StatusInternalServerError, err)
}

// ─── drives ──────────────────────────────────────────────────────────────────

func (s *Server) handleListDrives(w http.ResponseWriter, r *http.Request) {
	list, err := s.drives.List(r.Context())
	if err != nil {
		s.writeDriveErr(w, err)
		return
	}
	if list == nil {
		list = []drive.Drive{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleFormatDrive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device     string `json:"device"`
		Filesystem string `json:"filesystem"`
		Mountpoint string `json:"mountpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.drives.Format(r.Context(), body.Device, body.Filesystem, body.Mountpoint); err != nil {
		s.writeDriveErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMountDrive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device     string `json:"device"`
		Mountpoint string `json:"mountpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.drives.Mount(r.Context(), body.Device, body.Mountpoint); err != nil {
		s.writeDriveErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnmountDrive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device string `json:"device"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.drives.Unmount(r.Context(), body.Device); err != nil {
		s.writeDriveErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSetDataTarget(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Device string `json:"device"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.drives.SetDataTarget(r.Context(), body.Device); err != nil {
		s.writeDriveErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeDriveErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, drive.ErrUnsupported):
		writeJSONError(w, http.StatusNotImplemented, err)
	case errors.Is(err, drive.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err)
	case errors.Is(err, drive.ErrSystemDrive), errors.Is(err, drive.ErrDataTarget):
		writeJSONError(w, http.StatusForbidden, err)
	case errors.Is(err, drive.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, err)
	default:
		writeJSONError(w, http.StatusInternalServerError, err)
	}
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

// ─── backups ───────────────────────────────────────────────────────────────

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	list, err := s.backups.List(r.Context(), r.PathValue("id"))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	if list == nil {
		list = []backup.Backup{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	b, err := s.backups.Create(r.PathValue("id"), body.Name)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusAccepted, b)
}

func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Archive string `json:"archive"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.backups.Restore(r.Context(), r.PathValue("id"), body.Archive); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleLockBackup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Locked bool `json:"locked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.backups.SetLock(r.PathValue("id"), r.PathValue("archive"), body.Locked); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	err := s.backups.Delete(r.Context(), r.PathValue("id"), r.PathValue("archive"))
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, backup.ErrLocked) {
			status = http.StatusConflict
		}
		writeJSONError(w, status, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── redis browser ───────────────────────────────────────────────────────────
//
// The "Browser" add-on for a Redis server. The panel passes the admin password in
// the request body (over the pinned channel); the daemon resolves the container's
// published 6379 port itself and connects to 127.0.0.1:<hostPort> — it never
// trusts a caller-supplied address. The password is used to connect and dropped.

// redisConn resolves how to reach the server's Redis and builds a connection.
func (s *Server) redisConn(ctx context.Context, serverID, password string, db int) (redisbrowser.Conn, error) {
	port, err := s.dockerClient.PublishedTCPPort(ctx, serverID, 6379)
	if err != nil {
		return redisbrowser.Conn{}, err
	}
	return redisbrowser.Conn{
		Addr:     fmt.Sprintf("127.0.0.1:%d", port),
		Password: password,
		DB:       db,
	}, nil
}

// redisBody is the common envelope: every redis request carries the password + db,
// plus op-specific fields.
type redisBody struct {
	Password   string                   `json:"password"`
	DB         int                      `json:"db"`
	Pattern    string                   `json:"pattern,omitempty"`
	Cursor     string                   `json:"cursor,omitempty"`
	Count      int64                    `json:"count,omitempty"`
	Key        string                   `json:"key,omitempty"`
	NewKey     string                   `json:"newKey,omitempty"`
	TTLSeconds int64                    `json:"ttlSeconds,omitempty"`
	Set        *redisbrowser.SetRequest `json:"set,omitempty"`
}

// withRedis decodes the body, resolves the connection, and runs fn. op-level
// errors are mapped to status codes by writeRedisErr.
func (s *Server) withRedis(w http.ResponseWriter, r *http.Request, fn func(context.Context, redisbrowser.Conn, redisBody) (any, int, error)) {
	var body redisBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	conn, err := s.redisConn(r.Context(), r.PathValue("id"), body.Password, body.DB)
	if err != nil {
		// No container / port not published — the browser can't reach this server.
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	result, status, err := fn(r.Context(), conn, body)
	if err != nil {
		s.writeRedisErr(w, err)
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, status, result)
}

func (s *Server) handleRedisOverview(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, _ redisBody) (any, int, error) {
		ov, err := redisbrowser.GetOverview(ctx, conn)
		return ov, http.StatusOK, err
	})
}

func (s *Server) handleRedisKeys(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		list, err := redisbrowser.ScanKeys(ctx, conn, b.Pattern, b.Cursor, b.Count)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleRedisKey(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		d, err := redisbrowser.GetKey(ctx, conn, b.Key)
		return d, http.StatusOK, err
	})
}

func (s *Server) handleRedisSet(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		if b.Set == nil {
			return nil, 0, fmt.Errorf("%w: missing set payload", redisbrowser.ErrInvalid)
		}
		return nil, http.StatusNoContent, redisbrowser.SetKey(ctx, conn, *b.Set)
	})
}

func (s *Server) handleRedisDelete(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		return nil, http.StatusNoContent, redisbrowser.DeleteKey(ctx, conn, b.Key)
	})
}

func (s *Server) handleRedisRename(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		return nil, http.StatusNoContent, redisbrowser.RenameKey(ctx, conn, b.Key, b.NewKey)
	})
}

func (s *Server) handleRedisTTL(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, b redisBody) (any, int, error) {
		return nil, http.StatusNoContent, redisbrowser.SetTTL(ctx, conn, b.Key, b.TTLSeconds)
	})
}

func (s *Server) handleRedisFlush(w http.ResponseWriter, r *http.Request) {
	s.withRedis(w, r, func(ctx context.Context, conn redisbrowser.Conn, _ redisBody) (any, int, error) {
		return nil, http.StatusNoContent, redisbrowser.FlushDB(ctx, conn)
	})
}

func (s *Server) writeRedisErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, redisbrowser.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err)
	case errors.Is(err, redisbrowser.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, err)
	default:
		// A connection/auth failure to the instance — surface it for the panel toast.
		writeJSONError(w, http.StatusBadGateway, err)
	}
}

// ─── mongo browser ───────────────────────────────────────────────────────────
//
// Same posture as the redis browser: the panel passes the admin user + password
// in the body, the daemon resolves the container's published 27017 itself and
// connects to 127.0.0.1:<hostPort>.

func (s *Server) mongoConn(ctx context.Context, serverID, user, password string) (mongobrowser.Conn, error) {
	port, err := s.dockerClient.PublishedTCPPort(ctx, serverID, 27017)
	if err != nil {
		return mongobrowser.Conn{}, err
	}
	return mongobrowser.Conn{
		Addr:     fmt.Sprintf("127.0.0.1:%d", port),
		Username: user,
		Password: password,
	}, nil
}

type mongoBody struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	DB         string `json:"db,omitempty"`
	Collection string `json:"collection,omitempty"`
	Skip       int64  `json:"skip,omitempty"`
	Limit      int64  `json:"limit,omitempty"`
	ID         string `json:"id,omitempty"`
	Doc        string `json:"doc,omitempty"`
}

func (s *Server) withMongo(w http.ResponseWriter, r *http.Request, fn func(context.Context, mongobrowser.Conn, mongoBody) (any, int, error)) {
	var body mongoBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	conn, err := s.mongoConn(r.Context(), r.PathValue("id"), body.Username, body.Password)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	result, status, err := fn(r.Context(), conn, body)
	if err != nil {
		s.writeMongoErr(w, err)
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, status, result)
}

func (s *Server) handleMongoDatabases(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, _ mongoBody) (any, int, error) {
		list, err := mongobrowser.ListDatabases(ctx, conn)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleMongoCollections(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		list, err := mongobrowser.ListCollections(ctx, conn, b.DB)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleMongoDocuments(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		page, err := mongobrowser.FindDocuments(ctx, conn, b.DB, b.Collection, b.Skip, b.Limit)
		return page, http.StatusOK, err
	})
}

func (s *Server) handleMongoInsert(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		return nil, http.StatusNoContent, mongobrowser.InsertDocument(ctx, conn, b.DB, b.Collection, b.Doc)
	})
}

func (s *Server) handleMongoDelete(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		return nil, http.StatusNoContent, mongobrowser.DeleteDocument(ctx, conn, b.DB, b.Collection, b.ID)
	})
}

func (s *Server) handleMongoCreateCollection(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		return nil, http.StatusNoContent, mongobrowser.CreateCollection(ctx, conn, b.DB, b.Collection)
	})
}

func (s *Server) handleMongoDropCollection(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		return nil, http.StatusNoContent, mongobrowser.DropCollection(ctx, conn, b.DB, b.Collection)
	})
}

func (s *Server) handleMongoDropDatabase(w http.ResponseWriter, r *http.Request) {
	s.withMongo(w, r, func(ctx context.Context, conn mongobrowser.Conn, b mongoBody) (any, int, error) {
		return nil, http.StatusNoContent, mongobrowser.DropDatabase(ctx, conn, b.DB)
	})
}

func (s *Server) writeMongoErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mongobrowser.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err)
	case errors.Is(err, mongobrowser.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, err)
	default:
		writeJSONError(w, http.StatusBadGateway, err)
	}
}

// ─── sql browser ─────────────────────────────────────────────────────────────
//
// Same posture as the redis/mongo browsers: the panel passes the engine
// discriminator + admin user + password in the body; the daemon maps the engine
// to its container port (Postgres 5432, MySQL/MariaDB 3306), resolves the
// published host port itself, and connects to 127.0.0.1:<hostPort>.

func (s *Server) sqlConn(ctx context.Context, serverID string, b sqlBody) (sqlbrowser.Conn, error) {
	engine, err := sqlbrowser.ParseEngine(b.Engine)
	if err != nil {
		return sqlbrowser.Conn{}, err
	}
	containerPort := uint16(3306)
	if engine == sqlbrowser.Postgres {
		containerPort = 5432
	}
	port, err := s.dockerClient.PublishedTCPPort(ctx, serverID, containerPort)
	if err != nil {
		return sqlbrowser.Conn{}, err
	}
	return sqlbrowser.Conn{
		Engine:   engine,
		Addr:     fmt.Sprintf("127.0.0.1:%d", port),
		Username: b.Username,
		Password: b.Password,
	}, nil
}

type sqlBody struct {
	Engine   string `json:"engine"`
	Username string `json:"username"`
	Password string `json:"password"`
	DB       string `json:"db,omitempty"`
	Table    string `json:"table,omitempty"`
	Column   string `json:"column,omitempty"`
	Charset  string `json:"charset,omitempty"`
	Type     string `json:"type,omitempty"`
	Nullable bool   `json:"nullable,omitempty"`
	Key      string `json:"key,omitempty"`
	Name     string `json:"name,omitempty"`
	Host     string `json:"host,omitempty"`
	NewPass  string `json:"newPassword,omitempty"`
	Access   string `json:"access,omitempty"`
}

func (s *Server) withSQL(w http.ResponseWriter, r *http.Request, fn func(context.Context, sqlbrowser.Conn, sqlBody) (any, int, error)) {
	var body sqlBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	conn, err := s.sqlConn(r.Context(), r.PathValue("id"), body)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	result, status, err := fn(r.Context(), conn, body)
	if err != nil {
		s.writeSQLErr(w, err)
		return
	}
	if status == http.StatusNoContent {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, status, result)
}

func (s *Server) handleSQLDatabases(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, _ sqlBody) (any, int, error) {
		list, err := sqlbrowser.ListDatabases(ctx, conn)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleSQLCreateDatabase(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.CreateDatabase(ctx, conn, b.DB, b.Charset)
	})
}

func (s *Server) handleSQLDropDatabase(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.DropDatabase(ctx, conn, b.DB)
	})
}

func (s *Server) handleSQLTables(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		list, err := sqlbrowser.ListTables(ctx, conn, b.DB)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleSQLCreateTable(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.CreateTable(ctx, conn, b.DB, b.Table)
	})
}

func (s *Server) handleSQLDropTable(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.DropTable(ctx, conn, b.DB, b.Table)
	})
}

func (s *Server) handleSQLTruncateTable(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.TruncateTable(ctx, conn, b.DB, b.Table)
	})
}

func (s *Server) handleSQLColumns(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		list, err := sqlbrowser.ListColumns(ctx, conn, b.DB, b.Table)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleSQLAddColumn(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.AddColumn(ctx, conn, b.DB, b.Table, sqlbrowser.ColumnSpec{
			Name: b.Name, Type: b.Type, Nullable: b.Nullable, Key: b.Key,
		})
	})
}

func (s *Server) handleSQLDropColumn(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.DropColumn(ctx, conn, b.DB, b.Table, b.Column)
	})
}

func (s *Server) handleSQLUsers(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, _ sqlBody) (any, int, error) {
		list, err := sqlbrowser.ListUsers(ctx, conn)
		return list, http.StatusOK, err
	})
}

func (s *Server) handleSQLCreateUser(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.CreateUser(ctx, conn, sqlbrowser.UserSpec{
			Name: b.Name, Host: b.Host, Password: b.NewPass, Access: b.Access,
		})
	})
}

func (s *Server) handleSQLDropUser(w http.ResponseWriter, r *http.Request) {
	s.withSQL(w, r, func(ctx context.Context, conn sqlbrowser.Conn, b sqlBody) (any, int, error) {
		return nil, http.StatusNoContent, sqlbrowser.DropUser(ctx, conn, b.Name, b.Host)
	})
}

func (s *Server) writeSQLErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sqlbrowser.ErrNotFound):
		writeJSONError(w, http.StatusNotFound, err)
	case errors.Is(err, sqlbrowser.ErrInvalid):
		writeJSONError(w, http.StatusBadRequest, err)
	default:
		writeJSONError(w, http.StatusBadGateway, err)
	}
}

// ─── schedules ─────────────────────────────────────────────────────────────

func (s *Server) handleListSchedules(w http.ResponseWriter, _ *http.Request) {
	list, err := s.scheduler.List()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	if list == nil {
		list = []store.Schedule{}
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleUpsertSchedule(w http.ResponseWriter, r *http.Request) {
	var sc store.Schedule
	if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
		writeJSONError(w, http.StatusBadRequest, fmt.Errorf("decode: %w", err))
		return
	}
	if err := s.scheduler.Upsert(sc); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, sc)
}

func (s *Server) handleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	if err := s.scheduler.Remove(r.PathValue("id")); err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRunSchedule(w http.ResponseWriter, r *http.Request) {
	if err := s.scheduler.RunNow(r.PathValue("id")); err != nil {
		writeJSONError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── sftp sessions ─────────────────────────────────────────────────────────

// handleSftpMint creates a fresh per-session SFTP credential for the server and
// returns it once (the password is not recoverable afterward).
func (s *Server) handleSftpMint(w http.ResponseWriter, r *http.Request) {
	if s.sftp == nil {
		writeJSONError(w, http.StatusServiceUnavailable, errors.New("sftp is unavailable on this node"))
		return
	}
	session, err := s.sftp.Mint(r.PathValue("id"))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		sftp.Session
		Port int `json:"port"`
	}{Session: session, Port: sftp.DefaultPort})
}

// handleSftpStatus reports whether a server has a live SFTP session (no secret).
func (s *Server) handleSftpStatus(w http.ResponseWriter, r *http.Request) {
	if s.sftp == nil {
		writeJSON(w, http.StatusOK, struct {
			sftp.Info
			Port int `json:"port"`
		}{Info: sftp.Info{Active: false}, Port: sftp.DefaultPort})
		return
	}
	writeJSON(w, http.StatusOK, struct {
		sftp.Info
		Port int `json:"port"`
	}{Info: s.sftp.Active(r.PathValue("id")), Port: sftp.DefaultPort})
}

// handleSftpRevoke drops a server's SFTP session.
func (s *Server) handleSftpRevoke(w http.ResponseWriter, r *http.Request) {
	if s.sftp != nil {
		s.sftp.Revoke(r.PathValue("id"))
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
