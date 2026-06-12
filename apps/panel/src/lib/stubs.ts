// Placeholder data for the UI-first phase. One source of truth so pages agree —
// the same nodes are referenced across servers and networks, the same template
// labels recur, so the fleet reads as one believable org. Replace these when the
// data layer lands. Every row here is client-safe: no secrets, and never a raw
// Docker image string (templates expose only a friendly label).
//
// Ids are UUIDs, matching the real schema (the panel mints UUID primary keys);
// cross-entity references (a network's `serverIds`) use the owning entity's UUID.

import type { Template } from "@/lib/templates";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

export const CURRENT_USER = { name: "Jane Cooper", email: "jane@example.com" };

// — Nodes ————————————————————————————————————————————————————————————————————

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
		caps: { cpuCores: 14, memBytes: 56 * GiB, diskBytes: 1.8 * TiB },
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
		caps: { cpuCores: 12, memBytes: 30 * GiB, diskBytes: 960 * GiB },
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
		caps: { cpuCores: 20, memBytes: 112 * GiB, diskBytes: 3.5 * TiB },
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
		caps: { cpuCores: 8, memBytes: 14 * GiB, diskBytes: 460 * GiB },
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
		caps: { cpuCores: 8, memBytes: 14 * GiB, diskBytes: 960 * GiB },
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
		caps: null,
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
	/** Node it runs on (stable id + display name + panel-reachable address). */
	nodeId: string;
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
		nodeId: NODE_ID.atlas,
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
		nodeId: NODE_ID.atlas,
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
		nodeId: NODE_ID.valhalla,
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
		nodeId: NODE_ID.valhalla,
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
		nodeId: NODE_ID.orion,
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
		nodeId: NODE_ID.orion,
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
		nodeId: NODE_ID.helios,
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
// Full authoring records (the panel's "eggs"). Domain types + helpers live in
// lib/templates.ts; the mutable client store is lib/templates-store.ts. Image
// strings appear here because the *author* sees them in the editor — they're
// never surfaced on the catalog, the detail page, or a server.

export const TEMPLATES: Template[] = [
	{
		id: "c4d5e6f7-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
		name: "Minecraft: Java Edition",
		slug: "minecraft-java-edition",
		summary: "Vanilla Java server with auto EULA and tuned JVM flags.",
		description:
			"The official Mojang Java server, ready to play. Picks sane JVM flags for the memory you give it, accepts the EULA on first start, and exposes the settings most groups change — difficulty, gamemode, and the message of the day.",
		category: "Minecraft",
		official: true,
		origin: "official",
		status: "published",
		version: 7,
		serverCount: 4,
		updatedAt: "May 28, 2026",
		parentName: null,
		images: [
			{
				id: "img-mc-java21",
				label: "Java 21",
				image: "ghcr.io/pterodactyl/yolks:java_21",
				isDefault: true,
			},
			{
				id: "img-mc-java17",
				label: "Java 17",
				image: "ghcr.io/pterodactyl/yolks:java_17",
				isDefault: false,
			},
		],
		variables: [
			{
				id: "var-mc-version",
				name: "Server version",
				description: "Which Minecraft version to download.",
				envVariable: "MINECRAFT_VERSION",
				defaultValue: "latest",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-mc-difficulty",
				name: "Difficulty",
				description: "World difficulty.",
				envVariable: "DIFFICULTY",
				defaultValue: "normal",
				type: "select",
				required: true,
				options: ["peaceful", "easy", "normal", "hard"],
				access: "editable",
			},
			{
				id: "var-mc-motd",
				name: "Message of the day",
				description: "Shown in the server list.",
				envVariable: "SERVER_MOTD",
				defaultValue: "A CookiePanel server",
				type: "text",
				required: false,
				options: [],
				access: "editable",
			},
			{
				id: "var-mc-jar",
				name: "Server jar",
				description: "Internal: the downloaded jar filename.",
				envVariable: "SERVER_JARFILE",
				defaultValue: "server.jar",
				type: "text",
				required: true,
				options: [],
				access: "hidden",
			},
		],
		startupCommand:
			"java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui",
		stopType: "command",
		stopValue: "stop",
		doneMarkers: [{ kind: "regex", pattern: '\\)! For help, type "help"' }],
		installScript:
			'#!/bin/bash\n# Download the requested Minecraft server jar into /mnt/server.\napt-get update && apt-get install -y curl jq\ncd /mnt/server\necho "Fetching Minecraft server {{MINECRAFT_VERSION}}..."\ncurl -sSL -o {{SERVER_JARFILE}} https://launcher.example/minecraft/{{MINECRAFT_VERSION}}/server.jar\necho "eula=true" > eula.txt\n',
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [{ key: "minecraft:eula" }, { key: "minecraft:bukkit-plugins" }],
	},
	{
		id: "d5e6f7a8-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
		name: "Valheim Dedicated",
		slug: "valheim-dedicated",
		summary: "Dedicated Valheim world with crossplay and world backups.",
		description:
			"A dedicated Valheim world over SteamCMD. Crossplay is on by default; set a world name and a join password and you're ready.",
		category: "Survival",
		official: true,
		origin: "official",
		status: "published",
		version: 3,
		serverCount: 2,
		updatedAt: "May 12, 2026",
		parentName: null,
		images: [
			{
				id: "img-valheim",
				label: "SteamCMD (Debian)",
				image: "ghcr.io/pterodactyl/yolks:steamcmd_debian",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-vh-world",
				name: "World name",
				description: "The save the server loads.",
				envVariable: "WORLD_NAME",
				defaultValue: "Midgard",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-vh-password",
				name: "Join password",
				description: "Required to connect (min 5 characters).",
				envVariable: "SERVER_PASSWORD",
				defaultValue: null,
				type: "text",
				required: true,
				options: [],
				access: "secret",
			},
			{
				id: "var-vh-crossplay",
				name: "Crossplay",
				description: "Allow players from all platforms.",
				envVariable: "CROSSPLAY",
				defaultValue: "true",
				type: "toggle",
				required: false,
				options: [],
				access: "editable",
			},
		],
		startupCommand:
			"./valheim_server.x86_64 -name {{WORLD_NAME}} -world {{WORLD_NAME}} -password {{SERVER_PASSWORD}}",
		stopType: "signal",
		stopValue: "SIGINT",
		doneMarkers: [{ kind: "string", value: "Game server connected" }],
		installScript:
			"#!/bin/bash\n# Install the Valheim dedicated server via SteamCMD.\nsteamcmd +force_install_dir /mnt/server +login anonymous +app_update 896660 validate +quit\n",
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [],
	},
	{
		id: "e6f7a8b9-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
		name: "Palworld",
		slug: "palworld",
		summary: "Palworld dedicated server with configurable rates and caps.",
		description:
			"A Palworld dedicated server. Tune the capture and breeding rates and the player cap; everything else uses Pocketpair's defaults.",
		category: "Survival",
		official: true,
		origin: "official",
		status: "published",
		version: 2,
		serverCount: 1,
		updatedAt: "Apr 30, 2026",
		parentName: null,
		images: [
			{
				id: "img-palworld",
				label: "SteamCMD (Ubuntu)",
				image: "ghcr.io/pterodactyl/yolks:steamcmd_ubuntu",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-pw-name",
				name: "Server name",
				description: "Shown in the community server browser.",
				envVariable: "SERVER_NAME",
				defaultValue: "A Palworld Server",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-pw-players",
				name: "Max players",
				description: "Up to 32.",
				envVariable: "MAX_PLAYERS",
				defaultValue: "16",
				type: "number",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-pw-admin",
				name: "Admin password",
				description: "Grants in-game admin commands.",
				envVariable: "ADMIN_PASSWORD",
				defaultValue: null,
				type: "text",
				required: false,
				options: [],
				access: "secret",
			},
		],
		startupCommand:
			'./PalServer.sh -players={{MAX_PLAYERS}} -servername="{{SERVER_NAME}}"',
		stopType: "signal",
		stopValue: "SIGINT",
		doneMarkers: [{ kind: "string", value: "Setting breakpad minidump" }],
		installScript:
			"#!/bin/bash\nsteamcmd +force_install_dir /mnt/server +login anonymous +app_update 2394010 validate +quit\n",
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [{ key: "steam:gslt" }],
	},
	{
		id: "f7a8b9c0-4d5e-4f6a-9b7c-8d9e0f1a2b3c",
		name: "Factorio Headless",
		slug: "factorio-headless",
		summary: "Headless Factorio with mod-portal sync and autosave rotation.",
		description:
			"A headless Factorio server with rotating autosaves. Point it at a mod-portal token to keep mods in sync across restarts.",
		category: "Sandbox",
		official: true,
		origin: "official",
		status: "published",
		version: 6,
		serverCount: 1,
		updatedAt: "May 20, 2026",
		parentName: null,
		images: [
			{
				id: "img-factorio",
				label: "Factorio (latest)",
				image: "factoriotools/factorio:stable",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-fa-save",
				name: "Save name",
				description: "The map file to load or create.",
				envVariable: "SAVE_NAME",
				defaultValue: "world",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-fa-autosave",
				name: "Autosave interval",
				description: "Minutes between autosaves.",
				envVariable: "AUTOSAVE_INTERVAL",
				defaultValue: "10",
				type: "number",
				required: false,
				options: [],
				access: "editable",
			},
			{
				id: "var-fa-token",
				name: "Mod-portal token",
				description: "Used to download mods from the Factorio mod portal.",
				envVariable: "MOD_PORTAL_TOKEN",
				defaultValue: null,
				type: "text",
				required: false,
				options: [],
				access: "secret",
			},
		],
		startupCommand:
			"factorio --start-server /mnt/server/saves/{{SAVE_NAME}}.zip --autosave-interval {{AUTOSAVE_INTERVAL}}",
		stopType: "signal",
		stopValue: "SIGINT",
		doneMarkers: [{ kind: "string", value: "Starting RCON interface" }],
		installScript:
			"#!/bin/bash\n# Pull the latest stable Factorio headless build into /mnt/server.\ncurl -sSL https://factorio.example/get-download/stable/headless/linux64 | tar -xJ -C /mnt/server --strip-components=1\n",
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [],
	},
	{
		id: "a8b9c0d1-5e6f-4a7b-8c8d-9e0f1a2b3c4d",
		name: "Rust — Staff Event",
		slug: "rust-staff-event",
		summary: "Forked Rust build with our plugin pack and weekly wipe schedule.",
		description:
			"Our internal Rust build for staff events: the oxide plugin pack baked in and a weekly wipe. Customized from the official Rust template.",
		category: "Survival",
		official: false,
		origin: "fork",
		status: "published",
		version: 5,
		serverCount: 1,
		updatedAt: "Jun 09, 2026",
		parentName: "Rust",
		images: [
			{
				id: "img-rust",
				label: "SteamCMD (Debian)",
				image: "ghcr.io/pterodactyl/yolks:steamcmd_debian",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-rust-hostname",
				name: "Server name",
				description: "Shown in the Rust server browser.",
				envVariable: "HOSTNAME",
				defaultValue: "Staff Event — Wipe Fridays",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-rust-worldsize",
				name: "World size",
				description: "Map size in metres (1000–6000).",
				envVariable: "WORLD_SIZE",
				defaultValue: "3500",
				type: "number",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-rust-rcon",
				name: "RCON password",
				description: "Remote-console admin password.",
				envVariable: "RCON_PASS",
				defaultValue: null,
				type: "text",
				required: true,
				options: [],
				access: "secret",
			},
		],
		startupCommand:
			'./RustDedicated -batchmode +server.hostname "{{HOSTNAME}}" +server.worldsize {{WORLD_SIZE}} +rcon.password {{RCON_PASS}}',
		stopType: "command",
		stopValue: "quit",
		doneMarkers: [{ kind: "string", value: "Server startup complete" }],
		installScript:
			"#!/bin/bash\nsteamcmd +force_install_dir /mnt/server +login anonymous +app_update 258550 validate +quit\n# Drop in our staff plugin pack.\ncp -r /tmp/oxide-pack/* /mnt/server/oxide/plugins/\n",
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [],
	},
	{
		id: "b9c0d1e2-6f7a-4b8c-9d9e-0f1a2b3c4d5e",
		name: "Minecraft: Modded (Forge)",
		slug: "minecraft-modded-forge",
		summary: "Forge loader sized for large modpacks; community-curated pack.",
		description:
			"A Forge server tuned for heavy modpacks — extra heap headroom and a longer startup window. Imported from a community egg; review it before publishing more widely.",
		category: "Minecraft",
		official: false,
		origin: "import",
		status: "published",
		version: 1,
		serverCount: 2,
		updatedAt: "Jun 02, 2026",
		parentName: null,
		images: [
			{
				id: "img-forge",
				label: "Java 17",
				image: "ghcr.io/pterodactyl/yolks:java_17",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-forge-version",
				name: "Forge version",
				description: "Forge installer version to use.",
				envVariable: "FORGE_VERSION",
				defaultValue: "47.2.0",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-forge-mem",
				name: "Heap headroom",
				description: "Extra MB of heap for large packs.",
				envVariable: "EXTRA_HEAP",
				defaultValue: "2048",
				type: "number",
				required: false,
				options: [],
				access: "read-only",
			},
		],
		startupCommand:
			"java -Xmx{{SERVER_MEMORY}}M -jar forge-{{FORGE_VERSION}}.jar nogui",
		stopType: "command",
		stopValue: "stop",
		doneMarkers: [{ kind: "string", value: "Done (" }],
		installScript:
			'#!/bin/bash\ncd /mnt/server\ncurl -sSL -o forge-installer.jar "https://maven.example/forge/{{FORGE_VERSION}}/installer.jar"\njava -jar forge-installer.jar --installServer\necho "eula=true" > eula.txt\n',
		installContainerImage: "ghcr.io/pterodactyl/installers:java",
		installEntrypoint: "bash",
		installRiskAcked: false,
		features: [{ key: "minecraft:mods" }],
	},
	{
		id: "c0d1e2f3-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
		name: "Terraria (TShock)",
		slug: "terraria-tshock",
		summary: "TShock server with REST admin; in review before publishing.",
		description:
			"A TShock-powered Terraria server with the REST admin API. Still a draft — the startup flags are being finalized.",
		category: "Sandbox",
		official: false,
		origin: "scratch",
		status: "draft",
		version: 1,
		serverCount: 0,
		updatedAt: "Jun 11, 2026",
		parentName: null,
		images: [
			{
				id: "img-tshock",
				label: "Mono (Debian)",
				image: "ghcr.io/pterodactyl/yolks:mono_latest",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-ts-world",
				name: "World file",
				description: "The .wld to load.",
				envVariable: "WORLD_FILE",
				defaultValue: "world.wld",
				type: "text",
				required: true,
				options: [],
				access: "editable",
			},
			{
				id: "var-ts-maxplayers",
				name: "Max players",
				description: "Slot count.",
				envVariable: "MAX_PLAYERS",
				defaultValue: "8",
				type: "number",
				required: false,
				options: [],
				access: "editable",
			},
		],
		startupCommand:
			"mono TShock.Server.exe -world /mnt/server/worlds/{{WORLD_FILE}} -maxplayers {{MAX_PLAYERS}}",
		stopType: "command",
		stopValue: "exit",
		doneMarkers: [{ kind: "string", value: "Server started" }],
		installScript: "",
		installContainerImage: "",
		installEntrypoint: "bash",
		installRiskAcked: false,
		features: [],
	},
	{
		id: "d1e2f3a4-8b9c-4d0e-9f1a-2b3c4d5e6f70",
		name: "CS:GO Competitive",
		slug: "csgo-competitive",
		summary: "Legacy competitive config; superseded by our CS2 template.",
		description:
			"The old competitive CS:GO config. Archived now that CS2 has replaced it; kept so existing servers still resolve their template.",
		category: "FPS",
		official: false,
		origin: "scratch",
		status: "archived",
		version: 4,
		serverCount: 0,
		updatedAt: "Feb 18, 2026",
		parentName: null,
		images: [
			{
				id: "img-csgo",
				label: "SteamCMD (Debian)",
				image: "ghcr.io/pterodactyl/yolks:steamcmd_debian",
				isDefault: true,
			},
		],
		variables: [
			{
				id: "var-csgo-tickrate",
				name: "Tickrate",
				description: "Server tickrate.",
				envVariable: "TICKRATE",
				defaultValue: "128",
				type: "select",
				required: true,
				options: ["64", "128"],
				access: "editable",
			},
			{
				id: "var-csgo-gslt",
				name: "Game server token",
				description: "Steam Game Server Login Token.",
				envVariable: "GSLT",
				defaultValue: null,
				type: "text",
				required: true,
				options: [],
				access: "secret",
			},
		],
		startupCommand:
			"./srcds_run -game csgo -tickrate {{TICKRATE}} +sv_setsteamaccount {{GSLT}}",
		stopType: "signal",
		stopValue: "SIGINT",
		doneMarkers: [{ kind: "string", value: "GC Connection established" }],
		installScript:
			"#!/bin/bash\nsteamcmd +force_install_dir /mnt/server +login anonymous +app_update 740 validate +quit\n",
		installContainerImage: "ghcr.io/pterodactyl/installers:debian",
		installEntrypoint: "bash",
		installRiskAcked: true,
		features: [{ key: "steam:gslt" }],
	},
];

// — Drives / Allocations / Firewall (daemon-derived, per node) —————————————————

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

// Only the reporting (online/unhealthy) nodes have drives; offline/pending nodes
// show their tab's stale/empty state instead.
export const DRIVES: DriveRow[] = [
	{
		id: "5a1b2c3d-1111-4a22-8b33-aa01bb02cc03",
		nodeId: NODE_ID.atlas,
		device: "/dev/nvme0n1p1",
		model: "Samsung PM9A3",
		sizeBytes: 128 * GiB,
		usedBytes: 41 * GiB,
		filesystem: "ext4",
		mountpoint: "/",
		isDataTarget: false,
	},
	{
		id: "5a1b2c3d-2222-4a22-8b33-aa01bb02cc04",
		nodeId: NODE_ID.atlas,
		device: "/dev/nvme1n1",
		model: "Samsung PM9A3 1.9TB",
		sizeBytes: 2 * TiB,
		usedBytes: 1 * TiB,
		filesystem: "ext4",
		mountpoint: "/var/lib/cookiepanel",
		isDataTarget: true,
	},
	{
		id: "5a1b2c3d-3333-4a22-8b33-aa01bb02cc05",
		nodeId: NODE_ID.atlas,
		device: "/dev/sda",
		model: "Seagate IronWolf 4TB",
		sizeBytes: 4 * TiB,
		usedBytes: null,
		filesystem: null,
		mountpoint: null,
		isDataTarget: false,
	},
	{
		id: "6b2c3d4e-1111-4b33-9c44-bb02cc03dd04",
		nodeId: NODE_ID.valhalla,
		device: "/dev/sda2",
		model: "Crucial MX500",
		sizeBytes: 256 * GiB,
		usedBytes: 52 * GiB,
		filesystem: "ext4",
		mountpoint: "/",
		isDataTarget: false,
	},
	{
		id: "6b2c3d4e-2222-4b33-9c44-bb02cc03dd05",
		nodeId: NODE_ID.valhalla,
		device: "/dev/sdb1",
		model: "WD Red 1TB",
		sizeBytes: 1 * TiB,
		usedBytes: 700 * GiB,
		filesystem: "xfs",
		mountpoint: "/data",
		isDataTarget: true,
	},
	{
		id: "7c3d4e5f-1111-4c44-8d55-cc03dd04ee05",
		nodeId: NODE_ID.orion,
		device: "/dev/nvme0n1p1",
		model: "WD Black SN850X",
		sizeBytes: 1 * GiB,
		usedBytes: 0.3 * GiB,
		filesystem: "ext4",
		mountpoint: "/boot",
		isDataTarget: false,
	},
	{
		id: "7c3d4e5f-2222-4c44-8d55-cc03dd04ee06",
		nodeId: NODE_ID.orion,
		device: "/dev/nvme0n1p2",
		model: "WD Black SN850X",
		sizeBytes: 200 * GiB,
		usedBytes: 64 * GiB,
		filesystem: "ext4",
		mountpoint: "/",
		isDataTarget: false,
	},
	{
		id: "7c3d4e5f-3333-4c44-8d55-cc03dd04ee07",
		nodeId: NODE_ID.orion,
		device: "/dev/nvme1n1",
		model: "Micron 7450 3.84TB",
		sizeBytes: 4 * TiB,
		usedBytes: 1.5 * TiB,
		filesystem: "ext4",
		mountpoint: "/var/lib/cookiepanel",
		isDataTarget: true,
	},
	{
		id: "8d4e5f6a-1111-4d55-9e66-dd04ee05ff06",
		nodeId: NODE_ID.helios,
		device: "/dev/sda1",
		model: "Kingston DC600M",
		sizeBytes: 500 * GiB,
		usedBytes: 470 * GiB,
		filesystem: "ext4",
		mountpoint: "/",
		isDataTarget: false,
	},
	{
		id: "8d4e5f6a-2222-4d55-9e66-dd04ee05ff07",
		nodeId: NODE_ID.helios,
		device: "/dev/sdb1",
		model: "Kingston DC600M",
		sizeBytes: 500 * GiB,
		usedBytes: 180 * GiB,
		filesystem: "ext4",
		mountpoint: "/data",
		isDataTarget: true,
	},
];

export type AllocationProtocol = "tcp" | "udp";

export type AllocationRow = {
	id: string;
	nodeId: string;
	/** "0.0.0.0" = all interfaces. */
	ip: string;
	port: number;
	protocol: AllocationProtocol;
	/** null = free; else a real server. */
	serverId: string | null;
	serverName: string | null;
};

export const ALLOCATIONS: AllocationRow[] = [
	{
		id: "a1100001-0000-4a00-8a00-000000025565",
		nodeId: NODE_ID.atlas,
		ip: "0.0.0.0",
		port: 25565,
		protocol: "tcp",
		serverId: SERVER_ID.survivalSmp,
		serverName: "Survival SMP",
	},
	{
		id: "a1100002-0000-4a00-8a00-000000025566",
		nodeId: NODE_ID.atlas,
		ip: "0.0.0.0",
		port: 25566,
		protocol: "tcp",
		serverId: SERVER_ID.creativeBuild,
		serverName: "Creative Build",
	},
	{
		id: "a1100003-0000-4a00-8a00-000000025567",
		nodeId: NODE_ID.atlas,
		ip: "0.0.0.0",
		port: 25567,
		protocol: "tcp",
		serverId: null,
		serverName: null,
	},
	{
		id: "a1100004-0000-4a00-8a00-000000019132",
		nodeId: NODE_ID.atlas,
		ip: "0.0.0.0",
		port: 19132,
		protocol: "udp",
		serverId: null,
		serverName: null,
	},
	{
		id: "b2200001-0000-4b00-8b00-000000002456",
		nodeId: NODE_ID.valhalla,
		ip: "0.0.0.0",
		port: 2456,
		protocol: "udp",
		serverId: SERVER_ID.midgard,
		serverName: "Midgard",
	},
	{
		id: "b2200002-0000-4b00-8b00-000000002457",
		nodeId: NODE_ID.valhalla,
		ip: "0.0.0.0",
		port: 2457,
		protocol: "udp",
		serverId: SERVER_ID.midgard,
		serverName: "Midgard",
	},
	{
		id: "b2200003-0000-4b00-8b00-000000008211",
		nodeId: NODE_ID.valhalla,
		ip: "0.0.0.0",
		port: 8211,
		protocol: "udp",
		serverId: null,
		serverName: null,
	},
	{
		id: "c3300001-0000-4c00-8c00-000000028015",
		nodeId: NODE_ID.orion,
		ip: "0.0.0.0",
		port: 28015,
		protocol: "tcp",
		serverId: SERVER_ID.rustMain,
		serverName: "Rust Main",
	},
	{
		id: "c3300002-0000-4c00-8c00-000000128015",
		nodeId: NODE_ID.orion,
		ip: "0.0.0.0",
		port: 28015,
		protocol: "udp",
		serverId: SERVER_ID.rustMain,
		serverName: "Rust Main",
	},
	{
		id: "c3300003-0000-4c00-8c00-000000007777",
		nodeId: NODE_ID.orion,
		ip: "0.0.0.0",
		port: 7777,
		protocol: "tcp",
		serverId: SERVER_ID.terraria,
		serverName: "Terraria Co-op",
	},
	{
		id: "c3300004-0000-4c00-8c00-000000007778",
		nodeId: NODE_ID.orion,
		ip: "0.0.0.0",
		port: 7778,
		protocol: "tcp",
		serverId: null,
		serverName: null,
	},
	{
		id: "d4400001-0000-4d00-8d00-000000025567",
		nodeId: NODE_ID.helios,
		ip: "0.0.0.0",
		port: 25567,
		protocol: "tcp",
		serverId: SERVER_ID.modTesting,
		serverName: "Mod Testing",
	},
	{
		id: "d4400002-0000-4d00-8d00-000000025568",
		nodeId: NODE_ID.helios,
		ip: "0.0.0.0",
		port: 25568,
		protocol: "tcp",
		serverId: null,
		serverName: null,
	},
];

export type FirewallBackend = "ufw" | "iptables" | "none";
export type FirewallRule = { port: number; protocol: AllocationProtocol };
export type FirewallRow = {
	nodeId: string;
	backend: FirewallBackend;
	active: boolean;
	/** Open ports. SSH (22) and the daemon port are always present and locked. */
	rules: FirewallRule[];
};

export const FIREWALL: FirewallRow[] = [
	{
		nodeId: NODE_ID.atlas,
		backend: "ufw",
		active: true,
		rules: [
			{ port: 22, protocol: "tcp" },
			{ port: 8443, protocol: "tcp" },
			{ port: 25565, protocol: "tcp" },
			{ port: 25566, protocol: "tcp" },
		],
	},
	{
		nodeId: NODE_ID.valhalla,
		backend: "ufw",
		active: true,
		rules: [
			{ port: 22, protocol: "tcp" },
			{ port: 8443, protocol: "tcp" },
			{ port: 2456, protocol: "udp" },
			{ port: 2457, protocol: "udp" },
		],
	},
	{
		nodeId: NODE_ID.orion,
		backend: "iptables",
		active: true,
		rules: [
			{ port: 22, protocol: "tcp" },
			{ port: 8443, protocol: "tcp" },
			{ port: 28015, protocol: "tcp" },
			{ port: 28015, protocol: "udp" },
			{ port: 7777, protocol: "tcp" },
		],
	},
	{
		nodeId: NODE_ID.helios,
		backend: "iptables",
		active: false,
		rules: [
			{ port: 22, protocol: "tcp" },
			{ port: 8443, protocol: "tcp" },
			{ port: 25567, protocol: "tcp" },
		],
	},
	{
		nodeId: NODE_ID.nova,
		backend: "none",
		active: false,
		rules: [
			{ port: 22, protocol: "tcp" },
			{ port: 8443, protocol: "tcp" },
		],
	},
];

export function serversForNode(nodeId: string) {
	return SERVERS.filter((server) => server.nodeId === nodeId);
}
export function drivesForNode(nodeId: string) {
	return DRIVES.filter((drive) => drive.nodeId === nodeId);
}
export function allocationsForNode(nodeId: string) {
	return ALLOCATIONS.filter((allocation) => allocation.nodeId === nodeId);
}
export function firewallForNode(nodeId: string) {
	return FIREWALL.find((firewall) => firewall.nodeId === nodeId);
}
