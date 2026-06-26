import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type {
	DaemonRead,
	DriveRow,
	NodeCaps,
	NodeRow,
} from "@/lib/domain/nodes";
import {
	createNode as createNodeFn,
	formatDrive as formatDriveFn,
	getNode as getNodeFn,
	listNodeDrives as listNodeDrivesFn,
	listNodes,
	mountDrive as mountDriveFn,
	nodeHost as nodeHostFn,
	nodeStats as nodeStatsFn,
	pruneNode as pruneNodeFn,
	rebootNode as rebootNodeFn,
	removeNode as removeNodeFn,
	restartDaemon as restartDaemonFn,
	setDataTarget as setDataTargetFn,
	unmountDrive as unmountDriveFn,
	updateDaemon as updateDaemonFn,
	updateNode as updateNodeFn,
} from "@/server/nodes";

// Query factories + read hooks + mutation wrappers for the node registry — the
// panel-owned half of a Node. Live, daemon-derived state (status, hardware,
// usage) is NOT here: the server projects every node as `pending` until the
// daemon lands, and the UI degrades to that on its own. See panel.md / domain.md.
//
// Keys: `["nodes", "list"]` for the fleet, `["nodes", "detail", id]` for one
// node. Both live under the `["nodes"]` prefix so a single invalidation refreshes
// every consumer (list, detail tabs, sidebar count, command menu).

// ─── query factories ─────────────────────────────────────────────────────────

/** The active org's fleet. */
export function nodesListQueryOptions() {
	return queryOptions({
		queryKey: ["nodes", "list"] as const,
		queryFn: () => listNodes(),
		// The registry changes only on explicit create/rename/remove, but live
		// status is heartbeat-derived — poll (while focused) so a node's
		// pending → online flip and stale → offline show without a manual refresh.
		staleTime: 10_000,
		refetchInterval: 15_000,
	});
}

/** One node by id, for the detail layout + its tabs. */
export function nodeQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["nodes", "detail", id] as const,
		queryFn: () => getNodeFn({ data: { id } }),
		// A missing / cross-org id is a generic not-found; don't hammer it. The
		// detail layout renders its own not-found screen when this has no data.
		retry: false,
		// Poll a found node so its live status/heartbeat stay fresh; never poll a
		// not-found (no data) so a bad id isn't hammered.
		refetchInterval: (query) => (query.state.data ? 15_000 : false),
	});
}

/**
 * On-demand live utilization for a node — dials the daemon over the pinned
 * channel. Keyed outside the `["nodes"]` prefix so a registry mutation doesn't
 * trigger a box call. Polls briskly while focused; an unreachable box reads back
 * as `{ ok: false }` (not an error), so no retry.
 */
export function nodeStatsQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["node-live", "stats", id] as const,
		queryFn: () => nodeStatsFn({ data: { id } }),
		refetchInterval: 5_000,
		retry: false,
	});
}

/** On-demand host details for a node (slow-changing; lighter polling). */
export function nodeHostQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["node-live", "host", id] as const,
		queryFn: () => nodeHostFn({ data: { id } }),
		staleTime: 30_000,
		retry: false,
	});
}

/**
 * The node's physical disks (the Storage tab). Daemon-derived, so it degrades to
 * `{ ok: false }` offline. Disks change only on operator action, so it isn't
 * polled — the actions invalidate it. Keyed under `["node-live"]` so a registry
 * mutation doesn't dial the box.
 */
function nodeDrivesQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["node-live", "drives", id] as const,
		queryFn: () => listNodeDrivesFn({ data: { id } }),
		retry: false,
		staleTime: 10_000,
	});
}

export function useNodeDrives(id: string): DaemonRead<DriveRow[]> | undefined {
	return useQuery(nodeDrivesQueryOptions(id)).data;
}

// ─── read hooks ──────────────────────────────────────────────────────────────

export function useNodes(): NodeRow[] {
	return useQuery(nodesListQueryOptions()).data ?? [];
}

export function useNode(id: string): NodeRow | undefined {
	return useQuery(nodeQueryOptions(id)).data;
}

export type NodeCounts = { online: number; total: number };

/** The fleet's online/total counts for the sidebar readout. */
export function useNodeCounts(): NodeCounts {
	const nodes = useNodes();
	return {
		online: nodes.filter((node) => node.status === "online").length,
		total: nodes.length,
	};
}

// ─── mutations ───────────────────────────────────────────────────────────────
// Thin wrappers over the server fns with friendlier call shapes. Consumers call
// these, then invalidate via `invalidateNodes` (mirrors the eggs flow).

export type NewNode = {
	name: string;
	fqdn: string;
	daemonPort: number;
	/** Panel-minted subdomain + DNS, vs. an operator-pointed address. */
	managed: boolean;
};

/**
 * Register a node. Returns the (pending) registry row plus the single-use
 * enrollment command — the install line the operator runs on the box. The
 * plaintext token is returned exactly once and never readable again.
 */
export function createNode(input: NewNode) {
	return createNodeFn({ data: input });
}

export function updateNode(
	id: string,
	patch: { name?: string; fqdn?: string; daemonPort?: number }
) {
	return updateNodeFn({ data: { id, ...patch } });
}

export function updateNodeCaps(id: string, caps: NodeCaps) {
	return updateNodeFn({ data: { id, caps } });
}

export function removeNode(id: string) {
	return removeNodeFn({ data: { id } });
}

// ─── host maintenance + drives ───────────────────────────────────────────────

/** Reboot the whole host. */
export function rebootNode(id: string) {
	return rebootNodeFn({ data: { id } });
}

/** Free disk on the node (dangling images + build cache). Returns reclaimed. */
export function pruneNode(id: string) {
	return pruneNodeFn({ data: { id } });
}

/** Restart the wings agent (servers keep running). */
export function restartDaemon(id: string) {
	return restartDaemonFn({ data: { id } });
}

/** Install the latest daemon release, then restart the agent. */
export function updateDaemon(id: string) {
	return updateDaemonFn({ data: { id } });
}

export function formatDrive(
	id: string,
	device: string,
	filesystem: "ext4" | "xfs" | "btrfs",
	mountpoint: string
) {
	return formatDriveFn({ data: { id, device, filesystem, mountpoint } });
}

export function mountDrive(id: string, device: string, mountpoint: string) {
	return mountDriveFn({ data: { id, device, mountpoint } });
}

export function unmountDrive(id: string, device: string) {
	return unmountDriveFn({ data: { id, device } });
}

export function setDataTarget(id: string, device: string) {
	return setDataTargetFn({ data: { id, device } });
}

/** Refresh every node feed after a mutation. */
export function invalidateNodes(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["nodes"] });
}

/** Refresh a node's drive list (after a format/mount/unmount/data-target op). */
export function invalidateNodeDrives(
	queryClient: QueryClient,
	id: string
): Promise<void> {
	return queryClient.invalidateQueries({
		queryKey: ["node-live", "drives", id],
	});
}
