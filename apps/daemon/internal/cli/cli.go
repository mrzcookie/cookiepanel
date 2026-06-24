// Package cli implements cookied's command-line entrypoint. Subcommands:
//
//	configure     exchanges a single-use bootstrap token for durable credentials
//	run           heartbeats live system info to the panel
//	diagnostics   prints system info and checks panel connectivity
//	version       prints version information
//
// The HTTPS control API, the local IPC socket, Docker, networking, the firewall,
// and the scheduler land in later slices and will be wired into `run` then.
package cli

import (
	"context"
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

	"github.com/cookiepanel/cookied/internal/api"
	"github.com/cookiepanel/cookied/internal/backup"
	"github.com/cookiepanel/cookied/internal/credentials"
	"github.com/cookiepanel/cookied/internal/docker"
	"github.com/cookiepanel/cookied/internal/filesystem"
	"github.com/cookiepanel/cookied/internal/firewall"
	"github.com/cookiepanel/cookied/internal/network"
	"github.com/cookiepanel/cookied/internal/remote"
	"github.com/cookiepanel/cookied/internal/scheduler"
	"github.com/cookiepanel/cookied/internal/server"
	"github.com/cookiepanel/cookied/internal/sftp"
	"github.com/cookiepanel/cookied/internal/store"
	cookietls "github.com/cookiepanel/cookied/internal/tls"
	"github.com/cookiepanel/cookied/internal/version"
)

const (
	defaultDataDir  = "/etc/cookied"
	defaultStateDir = "/var/lib/cookied"
	defaultAPIPort  = 8443
)

// Run dispatches a cookied subcommand and returns a process exit code.
func Run(args []string) int {
	root := &cobra.Command{
		Use:           "cookied",
		Short:         "CookiePanel daemon",
		Version:       version.String(),
		SilenceUsage:  true,
		SilenceErrors: false,
	}
	root.AddCommand(
		newConfigureCmd(),
		newRunCmd(),
		newDiagnosticsCmd(),
		newVersionCmd(),
	)
	root.SetArgs(args)
	if err := root.Execute(); err != nil {
		return 1
	}
	return 0
}

func newConfigureCmd() *cobra.Command {
	var panelURL, nodeID, token, dataDir, fqdn string
	cmd := &cobra.Command{
		Use:   "configure",
		Short: "Activate this node against a panel using a bootstrap token",
		RunE: func(cmd *cobra.Command, _ []string) error {
			ctx, cancel := context.WithTimeout(cmd.Context(), 15*time.Second)
			defer cancel()

			client := remote.New(panelURL)
			res, err := client.Activate(ctx, remote.ActivateRequest{
				NodeID:         nodeID,
				BootstrapToken: token,
				FQDN:           fqdn,
			})
			if err != nil {
				return err
			}
			if err := credentials.Save(dataDir, credentials.Credentials{
				PanelURL:      panelURL,
				NodeID:        nodeID,
				NodeKey:       res.NodeKey,
				SigningSecret: res.SigningSecret,
				FQDN:          fqdn,
			}); err != nil {
				return err
			}
			fmt.Fprintf(os.Stderr,
				"activated node %q; credentials written to %s\n",
				nodeID, credentials.Path(dataDir))
			return nil
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

func newRunCmd() *cobra.Command {
	var dataDir, stateDir string
	var apiPort int
	var once bool
	var interval time.Duration
	cmd := &cobra.Command{
		Use:   "run",
		Short: "Start the daemon (heartbeat loop)",
		RunE: func(_ *cobra.Command, _ []string) error {
			creds, err := credentials.Load(dataDir)
			if err != nil {
				return fmt.Errorf("%w (run `cookied configure` first)", err)
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

			// Serving mode (not --once): provision the self-signed TLS cert whose
			// fingerprint the panel pins, then start the panel-facing HTTPS API.
			var fingerprint string
			if !once {
				if creds.FQDN == "" {
					return fmt.Errorf("credentials missing fqdn; re-run `cookied configure --fqdn <name>`")
				}
				tlsMat, err := cookietls.EnsureSelfSigned(filepath.Join(stateDir, "tls"), creds.FQDN)
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
					Files:         filesystem.New(dockerClient),
					SFTP:          sftpMgr,
					Scheduler:     sched,
					Backups:       backupMgr,
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
			}

			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return heartbeatLoop(ctx, creds, st, dockerClient, staticInfo, fingerprint, apiPort, interval, once)
		},
	}
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory holding credentials")
	cmd.Flags().StringVar(&stateDir, "state-dir", defaultStateDir, "directory for the local state db")
	cmd.Flags().IntVar(&apiPort, "api-port", defaultAPIPort, "TCP port the panel-facing HTTPS API will bind (advertised in the heartbeat)")
	cmd.Flags().BoolVar(&once, "once", false, "send a single heartbeat and exit (testing)")
	cmd.Flags().DurationVar(&interval, "interval", 30*time.Second, "heartbeat interval")
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
