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
	/** null = unmounted; "/" or "/boot" = the protected system disk. */
	mountpoint: string | null;
	/** Server data is stored here. */
	isDataTarget: boolean;
};

export type FirewallBackend = "ufw" | "iptables" | "none";
export type FirewallRule = { port: number; protocol: AllocationProtocol };
export type FirewallRow = {
	nodeId: string;
	backend: FirewallBackend;
	active: boolean;
	/** Open ports. SSH (22) and the daemon port are always present and locked. */
	rules: FirewallRule[];
};
