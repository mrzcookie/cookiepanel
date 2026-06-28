// Package cli implements wings's command-line entrypoint. Subcommands:
//
//	install       provisions the box end-to-end: activate, install Docker, register the service
//	configure     exchanges a single-use bootstrap token for durable credentials
//	run           serves the panel API + local control socket and heartbeats home
//	status        prints the daemon's live status via the local control socket
//	tui           offline operator console (talks only to the local socket)
//	diagnostics   prints system info and checks panel connectivity
//	version       prints version information
//
// `run` wires every subsystem: TLS + the panel-facing HTTPS API, Docker + the
// server lifecycle, the console WebSocket, networks/firewall, the file manager +
// SFTP, the scheduler + backups, host maintenance + drives, the box-local IPC
// socket, and the heartbeat loop.
package cli

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/spf13/cobra"

	"github.com/xena-studios/raptor/apps/wings/internal/api"
	"github.com/xena-studios/raptor/apps/wings/internal/backup"
	"github.com/xena-studios/raptor/apps/wings/internal/credentials"
	"github.com/xena-studios/raptor/apps/wings/internal/docker"
	"github.com/xena-studios/raptor/apps/wings/internal/drive"
	"github.com/xena-studios/raptor/apps/wings/internal/filesystem"
	"github.com/xena-studios/raptor/apps/wings/internal/firewall"
	"github.com/xena-studios/raptor/apps/wings/internal/ipc"
	"github.com/xena-studios/raptor/apps/wings/internal/network"
	"github.com/xena-studios/raptor/apps/wings/internal/remote"
	"github.com/xena-studios/raptor/apps/wings/internal/scheduler"
	"github.com/xena-studios/raptor/apps/wings/internal/server"
	"github.com/xena-studios/raptor/apps/wings/internal/sftp"
	"github.com/xena-studios/raptor/apps/wings/internal/store"
	"github.com/xena-studios/raptor/apps/wings/internal/system"
	wingstls "github.com/xena-studios/raptor/apps/wings/internal/tls"
	"github.com/xena-studios/raptor/apps/wings/internal/tui"
	"github.com/xena-studios/raptor/apps/wings/internal/version"
)

const (
	defaultDataDir  = "/etc/wings"
	defaultStateDir = "/var/lib/wings"
	defaultAPIPort  = 8443
)

// Run dispatches a wings subcommand and returns a process exit code.
func Run(args []string) int {
	root := &cobra.Command{
		Use:           "wings",
		Short:         "Raptor Wings",
		Version:       version.String(),
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	root.AddCommand(
		newInstallCmd(),
		newConfigureCmd(),
		newRunCmd(),
		newStatusCmd(),
		newTuiCmd(),
		newDiagnosticsCmd(),
		newVersionCmd(),
	)
	root.SetArgs(args)
	if err := root.Execute(); err != nil {
		return 1
	}
	return 0
}

// activation carries the inputs needed to exchange a single-use bootstrap token
// for durable credentials. Shared by `configure` (credentials only) and
// `install` (the full box provision).
type activation struct {
	PanelURL string
	NodeID   string
	Token    string
	FQDN     string
	DataDir  string
}

// activateNode exchanges the bootstrap token for the durable node key + signing
// secret and persists them. The token is single-use and time-limited, so callers
// that also do slow work (`install`) run this first.
func activateNode(ctx context.Context, a activation) error {
	actx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	client := remote.New(a.PanelURL)
	res, err := client.Activate(actx, remote.ActivateRequest{
		NodeID:         a.NodeID,
		BootstrapToken: a.Token,
		FQDN:           a.FQDN,
	})
	if err != nil {
		return err
	}
	if err := credentials.Save(a.DataDir, credentials.Credentials{
		PanelURL:      a.PanelURL,
		NodeID:        a.NodeID,
		NodeKey:       res.NodeKey,
		SigningSecret: res.SigningSecret,
		FQDN:          a.FQDN,
	}); err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr,
		"activated node %q; credentials written to %s\n",
		a.NodeID, credentials.Path(a.DataDir))
	return nil
}

func newConfigureCmd() *cobra.Command {
	var panelURL, nodeID, token, dataDir, fqdn string
	cmd := &cobra.Command{
		Use:   "configure",
		Short: "Activate this node against a panel using a bootstrap token",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return activateNode(cmd.Context(), activation{
				PanelURL: panelURL,
				NodeID:   nodeID,
				Token:    token,
				FQDN:     fqdn,
				DataDir:  dataDir,
			})
		},
	}
	cmd.Flags().StringVar(&panelURL, "panel", "", "panel base URL")
	cmd.Flags().StringVar(&nodeID, "node", "", "node id issued by the panel")
	cmd.Flags().StringVar(&token, "token", "", "single-use bootstrap token")
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory to store credentials")
	cmd.Flags().StringVar(&fqdn, "fqdn", "", "this box's FQDN (reported to the panel)")
	_ = cmd.MarkFlagRequired("panel")
	_ = cmd.MarkFlagRequired("node")
	_ = cmd.MarkFlagRequired("token")
	return cmd
}

// newInstallCmd provisions the box end-to-end. The panel's `install.sh` does
// nothing but fetch + verify the binary and hand off here, so this is where all
// the host setup lives: activate the node (token exchange), install Docker, then
// register + start the systemd service. The started service runs `wings run`,
// which opens its own firewall ports on startup — so nothing here touches ports
// directly. Must run as root.
func newInstallCmd() *cobra.Command {
	var panelURL, nodeID, token, dataDir, fqdn string
	var skipDocker bool
	cmd := &cobra.Command{
		Use:   "install",
		Short: "Provision this box: activate the node, install Docker, and register the systemd service",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if os.Geteuid() != 0 {
				return fmt.Errorf("install must run as root (use sudo)")
			}

			// 1. Claim durable credentials first: the bootstrap token is
			// single-use and time-limited, so exchange it before the slow Docker
			// install rather than risk it expiring mid-provision.
			if err := activateNode(cmd.Context(), activation{
				PanelURL: panelURL,
				NodeID:   nodeID,
				Token:    token,
				FQDN:     fqdn,
				DataDir:  dataDir,
			}); err != nil {
				return err
			}

			// 2. Install Docker (best-effort). The daemon runs without it — it
			// just can't host servers — so a failure warns and provisioning
			// continues; the operator can install Docker later.
			if skipDocker {
				fmt.Fprintln(os.Stderr, "skipping docker install (--skip-docker)")
			} else {
				fmt.Fprintln(os.Stderr, "ensuring docker is installed...")
				if err := system.EnsureDocker(cmd.Context()); err != nil {
					fmt.Fprintf(os.Stderr,
						"warning: docker not installed (%v); install it later to host servers\n", err)
				}
			}

			// 3. Register + start the systemd service. ExecStart points at the
			// resolved binary so a later self-update (which swaps the file in
			// place) keeps working; pass through a non-default data dir so `run`
			// finds the credentials we just wrote.
			self, err := os.Executable()
			if err != nil {
				return fmt.Errorf("locate executable: %w", err)
			}
			if resolved, rerr := filepath.EvalSymlinks(self); rerr == nil {
				self = resolved
			}
			execStart := self + " run"
			if dataDir != defaultDataDir {
				execStart += " --data-dir " + dataDir
			}
			fmt.Fprintln(os.Stderr, "registering the wings systemd service...")
			if err := system.InstallService(cmd.Context(), system.ServiceConfig{
				ExecStart: execStart,
			}); err != nil {
				return fmt.Errorf("install service: %w", err)
			}

			fmt.Fprintf(os.Stderr,
				"node %q provisioned; wings is running and will come online shortly.\n", nodeID)
			return nil
		},
	}
	cmd.Flags().StringVar(&panelURL, "panel", "", "panel base URL")
	cmd.Flags().StringVar(&nodeID, "node", "", "node id issued by the panel")
	cmd.Flags().StringVar(&token, "token", "", "single-use bootstrap token")
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory to store credentials")
	cmd.Flags().StringVar(&fqdn, "fqdn", "", "this box's FQDN (reported to the panel)")
	cmd.Flags().BoolVar(&skipDocker, "skip-docker", false, "don't install Docker (the host already manages it)")
	_ = cmd.MarkFlagRequired("panel")
	_ = cmd.MarkFlagRequired("node")
	_ = cmd.MarkFlagRequired("token")
	return cmd
}

func newRunCmd() *cobra.Command {
	var dataDir, stateDir, socketPath, acmeEmail string
	var apiPort int
	var once, acme bool
	var interval time.Duration
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Start the daemon (heartbeat loop)",
		RunE: func(_ *cobra.Command, _ []string) error {
			creds, err := credentials.Load(dataDir)
			if err != nil {
				return fmt.Errorf("%w (run `wings configure` first)", err)
			}

			st, err := store.Open(stateDir)
			if err != nil {
				return err
			}
			defer func() { _ = st.Close() }()

			// Docker init is non-fatal: a missing or unreachable engine reports
			// Available=false and the daemon keeps heartbeating + serving its API.
			dockerClient, err := docker.New()
			if err != nil {
				slog.Warn("docker client init failed; reporting unavailable", "err", err)
				dockerClient = nil
			}
			defer func() {
				if dockerClient != nil {
					_ = dockerClient.Close()
				}
			}()

			staticInfo := systemInfo()
			startedAt := time.Now().UTC()
			if err := st.PutStatus(store.Status{
				NodeID:          creds.NodeID,
				PanelURL:        creds.PanelURL,
				DaemonVersion:   version.Version,
				DaemonStartedAt: startedAt,
				SystemInfo:      composeInfo(context.Background(), dockerClient, staticInfo),
			}); err != nil {
				return fmt.Errorf("seed status: %w", err)
			}

			// The run's lifetime: cancelled on SIGINT/SIGTERM. Background workers
			// (the heartbeat loop, the download-job sweeper) hang off it.
			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			// Serving mode (not --once): provision the self-signed TLS cert whose
			// fingerprint the panel pins, then start the panel-facing HTTPS API.
			var fingerprint string
			if !once {
				if creds.FQDN == "" {
					return fmt.Errorf("credentials missing fqdn; re-run `wings configure --fqdn <name>`")
				}
				tlsDir := filepath.Join(stateDir, "tls")
				var tlsMat *wingstls.Material
				if acme {
					tlsMat, err = wingstls.EnsureAutocert(wingstls.AutocertConfig{
						CacheDir: filepath.Join(tlsDir, "acme"),
						FQDN:     creds.FQDN,
						Email:    acmeEmail,
					})
				} else {
					tlsMat, err = wingstls.EnsureSelfSigned(tlsDir, creds.FQDN)
				}
				if err != nil {
					return fmt.Errorf("provision tls: %w", err)
				}
				fingerprint = tlsMat.Fingerprint
				slog.Info("tls ready", "mode", tlsMat.Mode, "fqdn", creds.FQDN, "fingerprint", fingerprint)

				fw := firewall.NewManager(apiPort)
				serverMgr := server.NewManager(dockerClient)

				// SFTP server (best-effort): mints per-session credentials the
				// panel hands out, sandboxed per server. Non-fatal if it can't
				// start — the rest of the daemon keeps serving.
				sftpMgr, err := sftp.NewManager(dockerClient, stateDir)
				if err != nil {
					slog.Warn("sftp init failed; sftp disabled", "err", err)
					sftpMgr = nil
				}

				backupMgr := backup.NewManager(dockerClient, st)
				driveMgr := drive.NewManager(st)

				// File manager: start the URL-download job sweeper so finished jobs
				// don't accumulate over a long-lived daemon.
				filesMgr := filesystem.New(dockerClient)
				filesMgr.Jobs().StartSweeper(ctx)

				// Scheduler: server automations fire from the local store, so they
				// keep running across restarts and while the panel is offline.
				// Start failure is non-fatal — the daemon keeps serving.
				sched := scheduler.New(st, serverMgr, backupMgr)
				if err := sched.Start(); err != nil {
					slog.Warn("scheduler start failed", "err", err)
				} else {
					slog.Info("scheduler started")
					defer sched.Stop()
				}

				apiSrv := api.New(api.Config{
					Addr:          fmt.Sprintf(":%d", apiPort),
					NodeKey:       creds.NodeKey,
					NodeID:        creds.NodeID,
					SigningSecret: creds.SigningSecret,
					StaticInfo:    staticInfo,
					StartedAt:     startedAt,
					TLS:           tlsMat,
					DockerClient:  dockerClient,
					Servers:       serverMgr,
					Networks:      network.NewManager(dockerClient),
					Firewall:      fw,
					Files:         filesMgr,
					SFTP:          sftpMgr,
					Scheduler:     sched,
					Backups:       backupMgr,
					Drives:        driveMgr,
				})
				if err := apiSrv.Start(); err != nil {
					return err
				}
				slog.Info("api listening", "addr", fmt.Sprintf(":%d", apiPort))
				defer func() {
					sCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					_ = apiSrv.Shutdown(sCtx)
				}()

				// Open the host firewall for the panel-facing API port. Without this,
				// enabling ufw/iptables on the box silently blocks inbound to the API
				// and cuts the panel off — the daemon still heartbeats outbound, so the
				// node looks "online" while every control call fails. Best-effort + a
				// no-op when there's no firewall backend; the rule is tagged like our
				// others, and this port can never be closed (the Manager's protected-
				// port guard), so it can't lock the panel out later.
				_ = fw.Open(context.Background(), firewall.Rule{Port: apiPort, Protocol: "tcp"})

				// ACME HTTP-01 needs a plaintext responder on :80 — Let's Encrypt
				// dials port 80 for the challenge regardless of the API port. Open
				// the firewall for it and serve the autocert challenge handler there.
				if h := tlsMat.ChallengeHandler(); h != nil {
					_ = fw.Open(context.Background(), firewall.Rule{Port: 80, Protocol: "tcp"})
					challengeSrv := &http.Server{
						Addr:              ":80",
						Handler:           h,
						ReadHeaderTimeout: 10 * time.Second,
					}
					go func() {
						if err := challengeSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
							slog.Error("acme challenge server failed", "err", err)
						}
					}()
					slog.Info("acme http-01 challenge responder listening", "addr", ":80")
					defer func() {
						sCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						defer cancel()
						_ = challengeSrv.Shutdown(sCtx)
					}()
				}

				if sftpMgr != nil {
					if err := sftpMgr.Serve(fmt.Sprintf(":%d", sftp.DefaultPort)); err != nil {
						slog.Warn("sftp serve failed", "err", err)
					} else {
						slog.Info("sftp listening", "port", sftp.DefaultPort)
						_ = fw.Open(context.Background(), firewall.Rule{
							Port: sftp.DefaultPort, Protocol: "tcp",
						})
						defer sftpMgr.Shutdown()
					}
				}

				// Box-local control socket: lets the `tui`/`status` commands manage
				// the box (reusing the same server manager + store) even with the
				// panel unreachable. Non-fatal — a failed socket must not stop the
				// box from heartbeating.
				ipcSrv := ipc.New(ipc.Config{
					SocketPath: socketPath,
					Store:      st,
					Servers:    serverMgr,
					Docker:     dockerClient,
				})
				if err := ipcSrv.Start(); err != nil {
					slog.Warn("ipc start failed; local control socket disabled", "err", err)
				} else {
					slog.Info("ipc listening", "socket", socketPath)
					defer func() {
						sCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
						defer cancel()
						_ = ipcSrv.Shutdown(sCtx)
					}()
				}
			}

			return heartbeatLoop(ctx, creds, st, dockerClient, staticInfo, fingerprint, apiPort, interval, once)
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory holding credentials")
	cmd.Flags().StringVar(&stateDir, "state-dir", defaultStateDir, "directory for the local state db")
	cmd.Flags().StringVar(&socketPath, "socket", ipc.DefaultSocket, "path for the box-local control socket")
	cmd.Flags().IntVar(&apiPort, "api-port", defaultAPIPort, "TCP port the panel-facing HTTPS API will bind (advertised in the heartbeat)")
	cmd.Flags().BoolVar(&once, "once", false, "send a single heartbeat and exit (testing)")
	cmd.Flags().BoolVar(&acme, "acme", false, "obtain a Let's Encrypt cert for the FQDN (needs :80 reachable) instead of self-signed")
	cmd.Flags().StringVar(&acmeEmail, "acme-email", "", "ACME account contact email (optional, for renewal notices)")
	cmd.Flags().DurationVar(&interval, "interval", 30*time.Second, "heartbeat interval")
	return cmd
}

// newStatusCmd prints the running daemon's status by dialing its local control
// socket — works offline (no panel), useful for a quick health check on the box.
func newStatusCmd() *cobra.Command {
	var socketPath string
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print the daemon's live status (via the local control socket)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx, cancel := context.WithTimeout(cmd.Context(), 3*time.Second)
			defer cancel()
			st, err := ipc.NewClient(socketPath).Status(ctx)
			if err != nil {
				return fmt.Errorf("query daemon: %w", err)
			}
			beat := "never"
			if !st.LastHeartbeatAt.IsZero() {
				beat = st.LastHeartbeatAt.Local().Format(time.RFC3339)
			}
			fmt.Printf("node:           %s\n", st.NodeID)
			fmt.Printf("panel:          %s\n", st.PanelURL)
			fmt.Printf("daemon version: %s\n", st.DaemonVersion)
			fmt.Printf("started:        %s\n", st.DaemonStartedAt.Local().Format(time.RFC3339))
			fmt.Printf("last heartbeat: %s (ok=%t)\n", beat, st.LastHeartbeatOK)
			if st.LastHeartbeatErr != "" {
				fmt.Printf("heartbeat err:  %s\n", st.LastHeartbeatErr)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&socketPath, "socket", ipc.DefaultSocket, "path of the local control socket")
	return cmd
}

// newTuiCmd launches the offline operator console (talks only to the local
// socket — never the panel).
func newTuiCmd() *cobra.Command {
	var socketPath string
	cmd := &cobra.Command{
		Use:   "tui",
		Short: "Manage this box's servers locally (offline panel fallback)",
		RunE: func(_ *cobra.Command, _ []string) error {
			return tui.Run(socketPath)
		},
	}
	cmd.Flags().StringVar(&socketPath, "socket", ipc.DefaultSocket, "path of the local control socket")
	return cmd
}

func heartbeatLoop(
	ctx context.Context,
	creds *credentials.Credentials,
	st *store.Store,
	dockerClient *docker.Client,
	staticInfo map[string]any,
	certFingerprint string,
	apiPort int,
	interval time.Duration,
	once bool,
) error {
	client := remote.New(creds.PanelURL)

	beat := func() {
		hbCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		info := composeInfo(hbCtx, dockerClient, staticInfo)
		err := client.Heartbeat(hbCtx, creds.NodeKey, remote.HeartbeatBody{
			SystemInfo:      info,
			CertFingerprint: certFingerprint,
			DaemonPort:      apiPort,
		})
		now := time.Now().UTC()
		updateErr := st.UpdateStatus(func(cur store.Status) store.Status {
			cur.LastHeartbeatAt = now
			cur.LastHeartbeatOK = err == nil
			cur.SystemInfo = info
			if err != nil {
				cur.LastHeartbeatErr = err.Error()
			} else {
				cur.LastHeartbeatErr = ""
			}
			return cur
		})
		if updateErr != nil {
			slog.Error("persist status failed", "err", updateErr)
		}
		if err != nil {
			slog.Error("heartbeat failed", "err", err)
			return
		}
		slog.Info("heartbeat ok", "node_id", creds.NodeID)
	}

	beat()
	if once {
		return nil
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			beat()
		}
	}
}

func systemInfo() map[string]any {
	info := map[string]any{
		"os":            runtime.GOOS,
		"arch":          runtime.GOARCH,
		"cpus":          runtime.NumCPU(),
		"daemonVersion": version.Version,
	}
	// Total host capacity, so the panel can account per-node resource allocation.
	// Computed once at startup (cached into the heartbeat's static info).
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info["memTotalBytes"] = vm.Total
	}
	if du, err := disk.UsageWithContext(ctx, "/"); err == nil {
		info["diskTotalBytes"] = du.Total
	}
	return info
}

// composeInfo returns the heartbeat's system snapshot: the static host capacity
// plus a live docker probe (a 3s budget so a hung engine never stalls the beat).
func composeInfo(
	ctx context.Context,
	dockerClient *docker.Client,
	static map[string]any,
) map[string]any {
	out := make(map[string]any, len(static)+1)
	for k, v := range static {
		out[k] = v
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out["docker"] = dockerClient.Probe(probeCtx)
	return out
}

func newDiagnosticsCmd() *cobra.Command {
	var dataDir string
	cmd := &cobra.Command{
		Use:   "diagnostics",
		Short: "Print system info and check panel connectivity",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Println(version.String())
			for k, v := range systemInfo() {
				fmt.Printf("  %-14s %v\n", k, v)
			}
			creds, err := credentials.Load(dataDir)
			if err != nil {
				fmt.Println("credentials:    not configured")
				return
			}
			fmt.Printf("  panel          %s\n  node           %s\n", creds.PanelURL, creds.NodeID)
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get(creds.PanelURL + "/api/auth/ok")
			if err != nil {
				fmt.Printf("  panel reach    no (%v)\n", err)
				return
			}
			defer resp.Body.Close()
			fmt.Printf("  panel reach    %s\n", resp.Status)
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory holding credentials")
	return cmd
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print version information",
		Run: func(_ *cobra.Command, _ []string) {
			fmt.Println(version.String())
		},
	}
}
