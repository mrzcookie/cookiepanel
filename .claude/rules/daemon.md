# The daemon — `cookied`

> **Status.** `apps/daemon` has moved from a stdlib-only stub into an **active,
> phased build** (the panel's data layer is now mature). The target runtime is
> below, drawn from the complete prior daemon in `../cookiepanel-old`; it's being
> ported subsystem-by-subsystem in vertical slices — enrollment/heartbeat → HTTPS
> API + cert pinning → Docker/servers → console WebSocket → networks/firewall/
> ports → files/SFTP → schedules/backups → host maintenance → offline TUI. Treat
> the **design** as the durable signal; exact deps, ports, paths, and route
> prefixes are incidental.

`cookied` is a single Go binary that runs on each managed Linux box, **as root**.
It is the thing that does real work: Docker containers, host networking,
firewall, files, schedules, backups, OS maintenance. The panel is the control
plane; `cookied` is the hands on the box.

## Core properties

- **Runs as root → everything external is untrusted.** Validate all input up
  front; never shell-inject. See "Security posture" below and `security.md`.
- **Offline-resilient.** The daemon persists its desired state locally and keeps
  running when the panel is unreachable — schedules keep firing, the local
  control socket keeps working. The panel reconciles on reconnect. The box's
  local store is authoritative for the box.
- **Three traffic directions** (also in `architecture.md`):
  - **Panel → daemon:** an HTTPS API the panel calls (Bearer node key over TLS).
  - **Daemon → panel:** an HTTP client that enrolls the node, then **heartbeats**
    periodically with live system + Docker info, the cert fingerprint, and the
    API port.
  - **Box-local:** a **root-only Unix socket** for the on-box CLI/TUI, so the box
    is controllable locally even with the panel down.
- **One wiring point.** The `run` command starts every subsystem in order
  (load credentials → open local store → init Docker, best-effort → start the
  local socket → provision TLS → start the scheduler → start the API → enter the
  heartbeat loop) and shuts each down gracefully. Docker failing to init is
  **non-fatal**: the box still heartbeats and shows up in the panel.

## Subsystems (the target package layout)

| Concern | What it does |
|---|---|
| **CLI** | Command entrypoint. Subcommands like `configure`, `run`, `status`, `diagnostics`, `tui`, `version`. `run` orchestrates all of the below. |
| **Config** | Loads/persists non-secret config (panel URL, node id, FQDN, listen port, Docker socket). |
| **Credentials** | Persists the secrets the panel issues at enrollment — node key, signing secret, FQDN — `0600`, root-only. |
| **Remote** | The daemon→panel HTTP client: enroll (exchange bootstrap token → node key + signing secret) and heartbeat. |
| **API** | The panel-facing **HTTPS** server. Bearer-auth (constant-time compare of the node key) wraps every route; a panic in a handler becomes a 500, never crashes the box's control plane. |
| **Auth (JWT)** | Verifies the short-lived browser JWT for the console WebSocket — **HS256 only**, expiry required, bound to a specific server + node. |
| **WebSocket** | Browser-facing console: one socket multiplexes live logs **and** resource stats as typed JSON frames. Auth is the JWT (query param), verified locally. |
| **Docker** | Wraps the Docker Engine API. **Labels every managed container/volume** (`cookiepanel.*`) so the daemon only ever touches its own resources. |
| **Server** | Container lifecycle (create / start / stop / restart / delete, console + stats), and the **egg-style install pipeline**: run the untrusted install script **once in its own throwaway container** under a memory cap + hard timeout, then create the long-lived container. |
| **Network** | Docker network lifecycle (bridge / macvlan / ipvlan; subnet/gateway) + attach/detach a server. Names are regex-validated. |
| **Firewall** | Host firewall with **pluggable backends** chosen at runtime (ufw → iptables → no-op). Every rule is **tagged** so the daemon only manages its own rules — never the operator's. Opened/closed in lockstep with port allocations. |
| **Scheduler** | Local cron for server automations (steps: command / wait / power / backup). On the box so schedules fire while the panel is offline; rebuilt from the stored snapshot on change. |
| **Backup** | Snapshot/restore of a server's data volume, deduplicated with retention, run **in a short-lived container** (no host install needed). |
| **Filesystem** | Sandboxed per-server file manager (list/read/write/mkdir/rename/delete, upload/download, URL-download jobs), rooted at the server's volume, with a recycle bin. |
| **Disk quota** | Best-effort hard size cap on a server's data dir (real enforcement only where the FS supports it; a safe no-op elsewhere — never blocks server creation). |
| **System** | Host maintenance via a package-manager abstraction (apt/dnf/yum/pacman/zypper/apk): info/stats, hostname, reboot, OS updates, Docker prune. |
| **Store** | Embedded local state (an embedded key/value DB), `0600`. Holds node status + the schedule definitions so they survive offline. Source of truth for the box. |
| **IPC** | The local control socket (root-only Unix socket) exposing status + server controls to the TUI and CLI. Separate from the panel API so the box stays locally controllable offline. |
| **TLS** | Provisions the API cert: **self-signed** (pinned by the panel) or **ACME** for the FQDN. |
| **TUI** | A local terminal UI (offline operator fallback): list + start/stop/delete servers, view logs. Talks **only** to the local socket — never the panel. |
| **Version** | Build metadata injected at link time. |

## Security posture on the box

Because the daemon is root, validation is consistent and up front:

- **Paths:** file ops are sandboxed to the server's volume root; cleaned input is
  re-verified to stay under root before any OS call. No traversal.
- **Ports / protocols:** firewall normalizes to 1–65535 and tcp/udp only.
- **Names / ids:** regex allowlists for network names, backup ids, server names —
  no shell metacharacters.
- **No shell injection:** external tools (ufw, iptables, package managers, …) are
  invoked with **arg vectors, never a shell string**.
- **Untrusted code is isolated:** install scripts run in a resource-bounded
  throwaway container with a daemon-side hard timeout, not on the host.
- **Two distinct credentials:** the **node key** (Bearer, panel↔daemon,
  constant-time compared) and the per-node **signing secret** (HS256 for the
  short-lived browser console JWTs). Both issued by the panel at enrollment,
  stored `0600`, never re-derived locally.
- **Managed-resource isolation:** every container/volume is labelled and every
  firewall rule tagged, so the daemon never touches the operator's own host
  config.

## Build & run

- Module `github.com/cookiepanel/cookied`, Go (see `apps/daemon/go.mod`).
- `pnpm daemon:build` / `pnpm daemon:run` (Make targets). `make cross` builds
  linux amd64/arm64.
- `gofmt` + `go vet` are enforced by the lefthook pre-commit hook and CI.
- Current subcommands: `configure` (exchange a bootstrap token for durable
  credentials), `run` (TLS + HTTPS API + heartbeat loop), `diagnostics`,
  `version`. `run` wires Docker, the server lifecycle (incl. the egg install
  pipeline + config-file templating), the console WebSocket, networks/firewall,
  the sandboxed file manager (browse/edit/upload/download/archive), the embedded
  SFTP server, and the cron scheduler; the IPC socket and backups land in later
  slices.
