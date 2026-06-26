// Server domain types (client-safe; daemon-derived live state).

export type ServerState =
	| "running"
	| "stopped"
	| "starting"
	| "installing"
	| "failed";

export type ServerRow = {
	id: string;
	name: string;
	/** Friendly egg label — NEVER a raw image string. */
	eggName: string;
	/** The source egg (snapshotted at creation); resolves the variable
	 * schema + startup command shown on the Startup tab. */
	eggId: string;
	/** Friendly runtime label from the egg (e.g. "Java 21") — never the
	 * raw image string. */
	imageLabel: string;
	/** The source egg has a newer published version. */
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
	/** Allocated ceilings (the server's limits, not the node's). */
	cpuLimitCores: number;
	memLimitBytes: number;
	diskUsedBytes: number | null;
	diskLimitBytes: number;
	/** Seconds since the container started; null when not running. */
	uptimeSeconds: number | null;
	/** Pre-formatted creation date for the UI-first phase. */
	createdAt: string;
	/** Snapshot of the player-set variable values (envVariable → value). Secret
	 * variables are write-only and never appear here. */
	variables: Record<string, string>;
	/** Last failure message, shown when the server is `failed`. */
	lastError: string | null;
};
