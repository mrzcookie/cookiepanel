// Network + port-allocation domain types (client-safe; daemon-derived /
// panel-owned registry state).

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
