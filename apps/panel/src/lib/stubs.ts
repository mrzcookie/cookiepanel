// Placeholder data for the UI-first phase. One source of truth so pages agree —
// the same nodes are referenced across servers and networks, the same template
// labels recur, so the fleet reads as one believable org. Replace these when the
// data layer lands. Every row here is client-safe: no secrets, and never a raw
// Docker image string (templates expose only a friendly label).
//
// Ids are UUIDs, matching the real schema (the panel mints UUID primary keys);
// cross-entity references (a network's `serverIds`) use the owning entity's UUID.

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

export const CURRENT_USER = { name: "Jane Cooper", email: "jane@example.com" };

// — Nodes ————————————————————————————————————————————————————————————————————

export type NodeStatus = "online" | "offline" | "unhealthy" | "pending";

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
};

// Node UUIDs, referenced by servers (by name/address) and networks (by id).
const NODE_ID = {
	atlas: "a7f3c1d2-4e5b-4a6c-9d8e-1f2a3b4c5d6e",
	valhalla: "b8e4d2c3-5f6a-4b7d-8e9f-2a3b4c5d6e7f",
	orion: "c9f5e3d4-6a7b-4c8e-9f0a-3b4c5d6e7f80",
	helios: "d0a6f4e5-7b8c-4d9f-8a1b-4c5d6e7f8091",
	nova: "e1b7a5f6-8c9d-4e0a-9b2c-5d6e7f8091a2",
	titan: "f2c8b6a7-9d0e-4f1b-8c3d-6e7f8091a2b3",
} as const;

export const NODES: NodeRow[] = [
	{
		id: NODE_ID.atlas,
		name: "atlas-01",
		fqdn: "atlas-01.nodes.cookiepanel.app",
		daemonPort: 8443,
		managed: true,
		status: "online",
		publicIp: "203.0.113.18",
		os: "Ubuntu 24.04 LTS",
		arch: "x86_64",
		cpuCores: 16,
		memTotalBytes: 64 * GiB,
		diskTotalBytes: 2 * TiB,
		cpuPercent: 41,
		memUsedBytes: 37 * GiB,
		diskUsedBytes: 1 * TiB,
		serversRunning: 7,
		serversTotal: 8,
		daemonVersion: "1.4.2",
		updateAvailable: false,
		lastHeartbeat: "12s ago",
	},
	{
		id: NODE_ID.valhalla,
		name: "valhalla-eu",
		fqdn: "valhalla-eu.nodes.cookiepanel.app",
		daemonPort: 8443,
		managed: true,
		status: "online",
		publicIp: "198.51.100.42",
		os: "Debian 12",
		arch: "x86_64",
		cpuCores: 12,
		memTotalBytes: 32 * GiB,
		diskTotalBytes: 1 * TiB,
		cpuPercent: 73,
		memUsedBytes: 27 * GiB,
		diskUsedBytes: 700 * GiB,
		serversRunning: 5,
		serversTotal: 5,
		daemonVersion: "1.3.9",
		updateAvailable: true,
		lastHeartbeat: "8s ago",
	},
	{
		id: NODE_ID.orion,
		name: "orion-05",
		fqdn: "orion-05.nodes.cookiepanel.app",
		daemonPort: 8443,
		managed: true,
		status: "online",
		publicIp: "203.0.113.140",
		os: "Ubuntu 24.04 LTS",
		arch: "arm64",
		cpuCores: 24,
		memTotalBytes: 128 * GiB,
		diskTotalBytes: 4 * TiB,
		cpuPercent: 18,
		memUsedBytes: 40 * GiB,
		diskUsedBytes: 1.5 * TiB,
		serversRunning: 9,
		serversTotal: 11,
		daemonVersion: "1.4.2",
		updateAvailable: false,
		lastHeartbeat: "5s ago",
	},
	{
		id: NODE_ID.helios,
		name: "helios-03",
		fqdn: "node3.gamebox.example.com",
		daemonPort: 8443,
		managed: false,
		status: "unhealthy",
		publicIp: "192.0.2.77",
		os: "Rocky Linux 9",
		arch: "x86_64",
		cpuCores: 8,
		memTotalBytes: 16 * GiB,
		diskTotalBytes: 500 * GiB,
		cpuPercent: 96,
		memUsedBytes: 15 * GiB,
		diskUsedBytes: 480 * GiB,
		serversRunning: 3,
		serversTotal: 4,
		daemonVersion: "1.4.2",
		updateAvailable: false,
		lastHeartbeat: "2m ago",
	},
	{
		id: NODE_ID.nova,
		name: "nova-02",
		fqdn: "nova-02.nodes.cookiepanel.app",
		daemonPort: 8443,
		managed: true,
		status: "offline",
		publicIp: "203.0.113.91",
		os: "Ubuntu 22.04 LTS",
		arch: "arm64",
		cpuCores: 8,
		memTotalBytes: 16 * GiB,
		diskTotalBytes: 1 * TiB,
		cpuPercent: null,
		memUsedBytes: null,
		diskUsedBytes: null,
		serversRunning: null,
		serversTotal: 4,
		daemonVersion: "1.3.9",
		updateAvailable: true,
		lastHeartbeat: "1h 4m ago",
	},
	{
		id: NODE_ID.titan,
		name: "titan-07",
		fqdn: "titan-07.nodes.cookiepanel.app",
		daemonPort: 8443,
		managed: true,
		status: "pending",
		publicIp: null,
		os: null,
		arch: null,
		cpuCores: null,
		memTotalBytes: null,
		diskTotalBytes: null,
		cpuPercent: null,
		memUsedBytes: null,
		diskUsedBytes: null,
		serversRunning: null,
		serversTotal: null,
		daemonVersion: null,
		updateAvailable: false,
		lastHeartbeat: null,
	},
];

// — Servers ———————————————————————————————————————————————————————————————————

export type ServerState =
	| "running"
	| "stopped"
	| "starting"
	| "installing"
	| "failed";

export type ServerRow = {
	id: string;
	name: string;
	/** Friendly template label — NEVER a raw image string. */
	templateName: string;
	/** The source template has a newer published version. */
	updateAvailable: boolean;
	state: ServerState;
	/** Node it runs on (display name + the panel-reachable address). */
	nodeName: string;
	nodeAddress: string;
	/** Primary published port; null before a bind exists (installing). */
	port: number | null;
	/** Live readouts; null when the server isn't running. */
	cpuPercent: number | null;
	memUsedBytes: number | null;
	memLimitBytes: number;
};

// Server UUIDs, referenced by networks' `serverIds` membership.
const SERVER_ID = {
	survivalSmp: "3f9a1b2c-7d4e-4a8f-9b1c-2d3e4f5a6b7c",
	creativeBuild: "7b21c3d4-8e5f-4b9a-8c2d-3e4f5a6b7c8d",
	midgard: "a04e5f6a-9b7c-4c0d-8e1f-4a5b6c7d8e9f",
	palworld: "c5d8e6f7-0a8b-4d1e-9f2a-5b6c7d8e9f0a",
	rustMain: "1e6f7a8b-1c9d-4e2f-8a3b-6c7d8e9f0a1b",
	terraria: "9d2c8e3f-2d0e-4f3a-9b4c-7d8e9f0a1b2c",
	modTesting: "4a8b9c0d-3e1f-4a4b-8c5d-8e9f0a1b2c3d",
} as const;

export const SERVERS: ServerRow[] = [
	{
		id: SERVER_ID.survivalSmp,
		name: "Survival SMP",
		templateName: "Minecraft: Java Edition",
		updateAvailable: false,
		state: "running",
		nodeName: "atlas-01",
		nodeAddress: "atlas-01.nodes.cookiepanel.app",
		port: 25565,
		cpuPercent: 38,
		memUsedBytes: 3.6 * GiB,
		memLimitBytes: 6 * GiB,
	},
	{
		id: SERVER_ID.creativeBuild,
		name: "Creative Build",
		templateName: "Minecraft: Java Edition",
		updateAvailable: true,
		state: "running",
		nodeName: "atlas-01",
		nodeAddress: "atlas-01.nodes.cookiepanel.app",
		port: 25566,
		cpuPercent: 12,
		memUsedBytes: 2 * GiB,
		memLimitBytes: 4 * GiB,
	},
	{
		id: SERVER_ID.midgard,
		name: "Midgard",
		templateName: "Valheim",
		updateAvailable: false,
		state: "running",
		nodeName: "valhalla-eu",
		nodeAddress: "valhalla-eu.nodes.cookiepanel.app",
		port: 2456,
		cpuPercent: 64,
		memUsedBytes: 2.4 * GiB,
		memLimitBytes: 4 * GiB,
	},
	{
		id: SERVER_ID.palworld,
		name: "Palworld Dedicated",
		templateName: "Palworld",
		updateAvailable: false,
		state: "installing",
		nodeName: "valhalla-eu",
		nodeAddress: "valhalla-eu.nodes.cookiepanel.app",
		port: null,
		cpuPercent: null,
		memUsedBytes: null,
		memLimitBytes: 16 * GiB,
	},
	{
		id: SERVER_ID.rustMain,
		name: "Rust Main",
		templateName: "Rust",
		updateAvailable: true,
		state: "stopped",
		nodeName: "orion-05",
		nodeAddress: "orion-05.nodes.cookiepanel.app",
		port: 28015,
		cpuPercent: null,
		memUsedBytes: null,
		memLimitBytes: 8 * GiB,
	},
	{
		id: SERVER_ID.terraria,
		name: "Terraria Co-op",
		templateName: "Terraria",
		updateAvailable: false,
		state: "starting",
		nodeName: "orion-05",
		nodeAddress: "orion-05.nodes.cookiepanel.app",
		port: 7777,
		cpuPercent: 9,
		memUsedBytes: 0.4 * GiB,
		memLimitBytes: 2 * GiB,
	},
	{
		id: SERVER_ID.modTesting,
		name: "Mod Testing",
		templateName: "Minecraft: Java Edition",
		updateAvailable: false,
		state: "failed",
		nodeName: "helios-03",
		nodeAddress: "node3.gamebox.example.com",
		port: 25567,
		cpuPercent: null,
		memUsedBytes: null,
		memLimitBytes: 4 * GiB,
	},
];

// — Networks ——————————————————————————————————————————————————————————————————

export type NetworkDriver = "bridge" | "macvlan" | "ipvlan";

export type NetworkRow = {
	id: string;
	/** Docker network name (daemon-derived, regex-validated upstream). */
	name: string;
	/** UUID of the node this network lives on. */
	nodeId: string;
	/** Denormalized for the org-wide list (one network lives on one node). */
	nodeName: string;
	driver: NetworkDriver;
	/** CIDR; null when the driver auto-assigns. */
	subnet: string | null;
	gateway: string | null;
	/** true = isolated, no outbound access. */
	internal: boolean;
	/** Attached server UUIDs (membership lives here; the count is derived). */
	serverIds: string[];
};

export const NETWORKS: NetworkRow[] = [
	{
		id: "2b7c1d8e-4f3a-4b6c-9d1e-0a2b4c6d8e0f",
		name: "bridge",
		nodeId: NODE_ID.atlas,
		nodeName: "atlas-01",
		driver: "bridge",
		subnet: "172.17.0.0/16",
		gateway: "172.17.0.1",
		internal: false,
		serverIds: [SERVER_ID.survivalSmp, SERVER_ID.creativeBuild],
	},
	{
		id: "3c8d2e9f-5a4b-4c7d-8e2f-1b3c5d7e9f1a",
		name: "survival-lan",
		nodeId: NODE_ID.atlas,
		nodeName: "atlas-01",
		driver: "macvlan",
		subnet: "192.168.10.0/24",
		gateway: "192.168.10.1",
		internal: false,
		serverIds: [SERVER_ID.survivalSmp],
	},
	{
		id: "4d9e3f0a-6b5c-4d8e-9f3a-2c4d6e8f0a2b",
		name: "valheim-eu",
		nodeId: NODE_ID.valhalla,
		nodeName: "valhalla-eu",
		driver: "bridge",
		subnet: "172.20.0.0/16",
		gateway: "172.20.0.1",
		internal: false,
		serverIds: [SERVER_ID.midgard],
	},
	{
		id: "5e0f4a1b-7c6d-4e9f-8a4b-3d5e7f9a1b3c",
		name: "db-internal",
		nodeId: NODE_ID.valhalla,
		nodeName: "valhalla-eu",
		driver: "bridge",
		subnet: "172.21.0.0/16",
		gateway: "172.21.0.1",
		internal: true,
		serverIds: [SERVER_ID.midgard, SERVER_ID.palworld],
	},
	{
		id: "6f1a5b2c-8d7e-4f0a-9b5c-4e6f8a0b2c4d",
		name: "pub-edge",
		nodeId: NODE_ID.orion,
		nodeName: "orion-05",
		driver: "ipvlan",
		subnet: "10.30.0.0/16",
		gateway: "10.30.0.1",
		internal: false,
		serverIds: [SERVER_ID.rustMain],
	},
	{
		id: "7a2b6c3d-9e8f-4a1b-8c6d-5f7a9b1c3d5e",
		name: "rust-vlan",
		nodeId: NODE_ID.helios,
		nodeName: "helios-03",
		driver: "macvlan",
		subnet: "192.168.40.0/24",
		gateway: "192.168.40.1",
		internal: false,
		serverIds: [SERVER_ID.modTesting],
	},
	{
		id: "8b3c7d4e-0f9a-4b2c-9d7e-6a8b0c2d4e6f",
		name: "metrics-mesh",
		nodeId: NODE_ID.helios,
		nodeName: "helios-03",
		driver: "bridge",
		subnet: null,
		gateway: null,
		internal: true,
		serverIds: [],
	},
];

// — Templates —————————————————————————————————————————————————————————————————

export type TemplateOrigin = "official" | "scratch" | "import" | "fork";
export type TemplateStatus = "draft" | "published" | "archived";

export type TemplateRow = {
	id: string;
	name: string;
	slug: string;
	summary: string;
	category: string;
	/** Derived: organizationId === null. Official = platform-owned, read-only. */
	official: boolean;
	origin: TemplateOrigin;
	status: TemplateStatus;
	/** Bumps on re-publish. */
	version: number;
	/** Org servers deployed from this template (derived). */
	serverCount: number;
	updatedAt: string;
};

export const TEMPLATES: TemplateRow[] = [
	{
		id: "c4d5e6f7-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
		name: "Minecraft: Java Edition",
		slug: "minecraft-java-edition",
		summary: "Vanilla Java server with auto EULA and tuned JVM flags.",
		category: "Minecraft",
		official: true,
		origin: "official",
		status: "published",
		version: 7,
		serverCount: 4,
		updatedAt: "May 28, 2026",
	},
	{
		id: "d5e6f7a8-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
		name: "Valheim Dedicated",
		slug: "valheim-dedicated",
		summary: "Dedicated Valheim world with crossplay and world backups.",
		category: "Survival",
		official: true,
		origin: "official",
		status: "published",
		version: 3,
		serverCount: 2,
		updatedAt: "May 12, 2026",
	},
	{
		id: "e6f7a8b9-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
		name: "Palworld",
		slug: "palworld",
		summary: "Palworld dedicated server with configurable rates and caps.",
		category: "Survival",
		official: true,
		origin: "official",
		status: "published",
		version: 2,
		serverCount: 1,
		updatedAt: "Apr 30, 2026",
	},
	{
		id: "f7a8b9c0-4d5e-4f6a-9b7c-8d9e0f1a2b3c",
		name: "Factorio Headless",
		slug: "factorio-headless",
		summary: "Headless Factorio with mod-portal sync and autosave rotation.",
		category: "Sandbox",
		official: true,
		origin: "official",
		status: "published",
		version: 6,
		serverCount: 1,
		updatedAt: "May 20, 2026",
	},
	{
		id: "a8b9c0d1-5e6f-4a7b-8c8d-9e0f1a2b3c4d",
		name: "Rust — Staff Event",
		slug: "rust-staff-event",
		summary: "Forked Rust build with our plugin pack and weekly wipe schedule.",
		category: "Survival",
		official: false,
		origin: "fork",
		status: "published",
		version: 5,
		serverCount: 1,
		updatedAt: "Jun 09, 2026",
	},
	{
		id: "b9c0d1e2-6f7a-4b8c-9d9e-0f1a2b3c4d5e",
		name: "Minecraft: Modded (Forge)",
		slug: "minecraft-modded-forge",
		summary: "Forge loader sized for large modpacks; community-curated pack.",
		category: "Minecraft",
		official: false,
		origin: "import",
		status: "published",
		version: 1,
		serverCount: 2,
		updatedAt: "Jun 02, 2026",
	},
	{
		id: "c0d1e2f3-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
		name: "Terraria (TShock)",
		slug: "terraria-tshock",
		summary: "TShock server with REST admin; in review before publishing.",
		category: "Sandbox",
		official: false,
		origin: "scratch",
		status: "draft",
		version: 1,
		serverCount: 0,
		updatedAt: "Jun 11, 2026",
	},
	{
		id: "d1e2f3a4-8b9c-4d0e-9f1a-2b3c4d5e6f70",
		name: "CS:GO Competitive",
		slug: "csgo-competitive",
		summary: "Legacy competitive config; superseded by our CS2 template.",
		category: "FPS",
		official: false,
		origin: "scratch",
		status: "archived",
		version: 4,
		serverCount: 0,
		updatedAt: "Feb 18, 2026",
	},
];
