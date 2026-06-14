import type { NodeCaps, NodeRow } from "@/lib/domain/nodes";
import { createStore } from "@/lib/store";
import { NODES } from "@/lib/stubs";

// Mutable client-side stub store for nodes — the stand-in for the data layer.
// The node list and the node detail tabs are separate routes, so they share this
// one source of truth; rename / remove / cap edits on the Settings tab reflect on
// the list without a reload. Mutations happen only in the browser; the server
// snapshot stays the seeded stub (SSR and the first client render agree).
// Replaced wholesale when the real data layer lands.

const store = createStore<NodeRow[]>(NODES);

export function useNodes() {
	return store.use();
}

export function useNode(id: string) {
	return useNodes().find((node) => node.id === id);
}

export type NodeCounts = { online: number; total: number };

function sameCounts(a: NodeCounts, b: NodeCounts) {
	return a.online === b.online && a.total === b.total;
}

/**
 * The fleet's online/total node counts. A selector subscription so the sidebar
 * readout only re-renders when a count changes, not on every node mutation.
 */
export function useNodeCounts(): NodeCounts {
	return store.useWith(
		(nodes) => ({
			online: nodes.filter((node) => node.status === "online").length,
			total: nodes.length,
		}),
		sameCounts
	);
}

export type NewNode = {
	name: string;
	fqdn: string;
	daemonPort: number;
	/** Panel-minted subdomain + DNS, vs. an operator-pointed address. */
	managed: boolean;
};

/**
 * Create a freshly-enrolled node. It lands `pending` with no hardware yet — the
 * same shape as a real node between "the panel minted a bootstrap token" and
 * "the daemon first reported in" (mirrors the seeded titan-07). The panel owns
 * the operator-set address; everything daemon-derived stays null until the box
 * heartbeats (simulated by `connectNode`).
 */
export function addNode(input: NewNode): NodeRow {
	const node: NodeRow = {
		id: crypto.randomUUID(),
		name: input.name.trim(),
		fqdn: input.fqdn.trim(),
		daemonPort: input.daemonPort,
		managed: input.managed,
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
	};
	store.set([node, ...store.get()]);
	return node;
}

// Plausible detected hardware for the simulated first heartbeat. Fixed (not
// random) so the connect-a-node flow reads the same every run; the real values
// come from the daemon once it reports in.
const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

/**
 * Simulate the daemon phoning home for the first time: the node flips
 * `pending → online` and its detected hardware, usage, version, and allocatable
 * caps appear. No-op once a node is past `pending`. The wizard fires this on a
 * short delay to stand in for a real first heartbeat.
 */
export function connectNode(id: string) {
	store.set(
		store.get().map((node) =>
			node.id === id && node.status === "pending"
				? {
						...node,
						status: "online",
						publicIp: "203.0.113.24",
						os: "Ubuntu 24.04 LTS",
						arch: "x86_64",
						cpuCores: 8,
						memTotalBytes: 32 * GiB,
						diskTotalBytes: 1 * TiB,
						cpuPercent: 3,
						memUsedBytes: 2 * GiB,
						diskUsedBytes: 18 * GiB,
						serversRunning: 0,
						serversTotal: 0,
						daemonVersion: "1.4.2",
						updateAvailable: false,
						lastHeartbeat: "just now",
						caps: {
							cpuCores: 7,
							memBytes: 28 * GiB,
							diskBytes: 0.9 * TiB,
						},
					}
				: node
		)
	);
}

export function updateNode(
	id: string,
	patch: Partial<Pick<NodeRow, "name" | "fqdn" | "daemonPort" | "publicIp">>
) {
	store.set(
		store.get().map((node) => (node.id === id ? { ...node, ...patch } : node))
	);
}

export function removeNode(id: string) {
	store.set(store.get().filter((node) => node.id !== id));
}

export function updateNodeCaps(id: string, caps: NodeCaps) {
	store.set(
		store.get().map((node) => (node.id === id ? { ...node, caps } : node))
	);
}
