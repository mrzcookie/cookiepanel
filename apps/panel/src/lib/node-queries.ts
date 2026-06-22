import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { NodeCaps, NodeRow } from "@/lib/domain/nodes";
import {
	createNode as createNodeFn,
	getNode as getNodeFn,
	listNodes,
	removeNode as removeNodeFn,
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
		// The registry changes only on explicit create/rename/remove; keep it warm
		// so the sidebar count and cross-page reads don't refetch on navigation.
		staleTime: 10_000,
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
	});
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
// these, then invalidate via `invalidateNodes` (mirrors the templates flow).

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

/** Refresh every node feed after a mutation. */
export function invalidateNodes(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["nodes"] });
}
