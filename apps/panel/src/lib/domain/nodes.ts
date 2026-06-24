// Node domain types (client-safe; daemon-derived live state), plus the
// per-node drive / firewall types the node detail tabs render.

import type { AllocationProtocol } from "@/lib/domain/networks";

export type NodeStatus = "online" | "offline" | "unhealthy" | "pending";

/** Operator-set allocatable ceilings, at or below the node's detected hardware. */
export type NodeCaps = {
	cpuCores: number;
	memBytes: number;
	diskBytes: number;
};

export type NodeRow = {
	id: string;
	/** Display name. The stable identity is `id`, not this. */
	name: string;
	/** Where the panel reaches the daemon. */
	fqdn: string;
	daemonPort: number;
	/** Panel-minted subdomain + DNS, vs. an operator-pointed address. */
	managed: boolean;
	status: NodeStatus;
	publicIp: string | null;
	/** Friendly OS label — never a raw image string. */
	os: string | null;
	arch: "x86_64" | "arm64" | null;
	cpuCores: number | null;
	memTotalBytes: number | null;
	diskTotalBytes: number | null;
	/** Live usage. null when offline (stale) or pending (never reported). */
	cpuPercent: number | null;
	memUsedBytes: number | null;
	diskUsedBytes: number | null;
	serversRunning: number | null;
	serversTotal: number | null;
	daemonVersion: string | null;
	updateAvailable: boolean;
	/** Pre-formatted relative time for the UI-first phase. */
	lastHeartbeat: string | null;
	/** Operator-set allocatable ceilings; null until hardware is detected. */
	caps: NodeCaps | null;
};

/** Live utilization sampled on demand from the daemon (the stats channel). */
export type NodeLiveStats = {
	cpuPercent: number;
	memUsedBytes: number;
	memTotalBytes: number;
	diskUsedBytes: number;
	diskTotalBytes: number;
	load1: number;
	load5: number;
	load15: number;
};

/** Slow-changing host details, read on demand from the daemon. */
export type NodeHostInfo = {
	hostname: string;
	platform: string;
	platformVersion: string;
	kernel: string;
	cpuModel: string;
	cpuCount: number;
	uptimeSeconds: number;
};

/**
 * The result of an on-demand daemon read. A box can be unreachable (offline,
 * mid-restart, firewalled) without that being a panel error, so these reads
 * degrade to `{ ok: false }` rather than throwing — the UI shows the box as
 * unreachable instead of erroring the page.
 */
export type DaemonRead<T> =
	| { ok: true; data: T }
	| { ok: false; error: string };

export type DriveRow = {
	id: string;
	nodeId: string;
	/** e.g. "/dev/nvme0n1p1". */
	device: string;
	/** Friendly model string, never an image. */
	model: string;
	sizeBytes: number;
	/** null when unmounted (no usage to read). */
	usedBytes: number | null;
	/** null = unformatted. */
	filesystem: string | null;
	/** null = unmounted. */
	mountpoint: string | null;
	/** Server data is stored here. */
	isDataTarget: boolean;
	/**
	 * The OS/system disk (it — or a partition under it — holds `/`, `/boot`, …).
	 * The daemon computes this across the whole block-device tree (a disk whose
	 * own mountpoint is empty can still be system via its partitions), so the UI
	 * locks it against format/mount/unmount rather than guessing from mountpoint.
	 */
	system: boolean;
};

export type FirewallBackend = "ufw" | "iptables" | "none";
type FirewallRule = { port: number; protocol: AllocationProtocol };
export type FirewallRow = {
	nodeId: string;
	backend: FirewallBackend;
	active: boolean;
	/** Open ports. SSH (22) and the daemon port are always present and locked. */
	rules: FirewallRule[];
};
