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
	"runtime"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/spf13/cobra"

	"github.com/cookiepanel/cookied/internal/credentials"
	"github.com/cookiepanel/cookied/internal/remote"
	"github.com/cookiepanel/cookied/internal/store"
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
	cmd.Flags().StringVar(&token, "activate", "", "single-use bootstrap token")
	cmd.Flags().StringVar(&dataDir, "data-dir", defaultDataDir, "directory to store credentials")
	cmd.Flags().StringVar(&fqdn, "fqdn", "", "this box's FQDN (reported to the panel)")
	_ = cmd.MarkFlagRequired("panel")
	_ = cmd.MarkFlagRequired("node")
	_ = cmd.MarkFlagRequired("activate")
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

			staticInfo := systemInfo()
			startedAt := time.Now().UTC()
			if err := st.PutStatus(store.Status{
				NodeID:          creds.NodeID,
				PanelURL:        creds.PanelURL,
				DaemonVersion:   version.Version,
				DaemonStartedAt: startedAt,
				SystemInfo:      composeInfo(staticInfo),
			}); err != nil {
				return fmt.Errorf("seed status: %w", err)
			}

			ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			return heartbeatLoop(ctx, creds, st, staticInfo, apiPort, interval, once)
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
	staticInfo map[string]any,
	apiPort int,
	interval time.Duration,
	once bool,
) error {
	client := remote.New(creds.PanelURL)

	beat := func() {
		hbCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		info := composeInfo(staticInfo)
		err := client.Heartbeat(hbCtx, creds.NodeKey, remote.HeartbeatBody{
			SystemInfo: info,
			DaemonPort: apiPort,
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
// plus a docker section. A live Docker probe replaces the placeholder once the
// Docker subsystem lands; until then docker is reported unavailable so the panel
// renders "no container engine" honestly rather than guessing.
func composeInfo(static map[string]any) map[string]any {
	out := make(map[string]any, len(static)+1)
	for k, v := range static {
		out[k] = v
	}
	out["docker"] = map[string]any{"available": false}
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
