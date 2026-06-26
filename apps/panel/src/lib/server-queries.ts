import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { ServerRow } from "@/lib/domain/servers";
import {
	createServer as createServerFn,
	listServers,
	listServersForNode,
	mintServerToken as mintServerTokenFn,
	removeServer as removeServerFn,
	renameServer as renameServerFn,
	restartServer as restartServerFn,
	sendServerCommand as sendServerCommandFn,
	startServer as startServerFn,
	stopServer as stopServerFn,
	syncServer,
	updateServerLimits as updateServerLimitsFn,
	updateServerRuntime as updateServerRuntimeFn,
	updateServerVariables as updateServerVariablesFn,
} from "@/server/servers";

// Query factories + read hooks + mutation wrappers for servers — the registry
// half (name/egg/node/limits/variables/state) plus the daemon-driven
// lifecycle. The list reads stored state (fast); a server's detail reconciles its
// live container state with the daemon on each poll (`syncServer`).
//
// Keys live under the `["servers"]` prefix so one `invalidateServers` refreshes
// every consumer (list, detail, node card, command menu).

// ─── query factories ─────────────────────────────────────────────────────────

/** The active org's servers. */
export function serversListQueryOptions() {
	return queryOptions({
		queryKey: ["servers", "list"] as const,
		queryFn: () => listServers(),
		staleTime: 10_000,
		// State is daemon-derived — poll (while focused) so power changes show.
		refetchInterval: 15_000,
	});
}

/** One server, with its live state reconciled against the node's daemon. */
export function serverQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["servers", "detail", id] as const,
		queryFn: () => syncServer({ data: { id } }),
		retry: false,
		refetchInterval: 5_000,
	});
}

/** Servers on one node, for the node-detail card. */
function serversForNodeQueryOptions(nodeId: string) {
	return queryOptions({
		queryKey: ["servers", "node", nodeId] as const,
		queryFn: () => listServersForNode({ data: { nodeId } }),
		staleTime: 10_000,
	});
}

// ─── read hooks ──────────────────────────────────────────────────────────────

export function useServers(): ServerRow[] {
	return useQuery(serversListQueryOptions()).data ?? [];
}

export function useServer(id: string): ServerRow | undefined {
	return useQuery(serverQueryOptions(id)).data;
}

export function useServersForNode(nodeId: string): ServerRow[] {
	return useQuery(serversForNodeQueryOptions(nodeId)).data ?? [];
}

// ─── mutations ───────────────────────────────────────────────────────────────
// Thin async wrappers over the server fns. Consumers call these, then invalidate
// via `invalidateServers`.

export type NewServer = {
	nodeId: string;
	eggId: string;
	name: string;
	runtimeLabel?: string;
	port: number;
	cpuLimitCores: number;
	memLimitBytes: number;
	diskLimitBytes: number;
	variables: Record<string, string>;
};

export function createServer(input: NewServer) {
	return createServerFn({ data: input });
}

export function startServer(id: string) {
	return startServerFn({ data: { id } });
}

export function stopServer(id: string) {
	return stopServerFn({ data: { id } });
}

export function restartServer(id: string) {
	return restartServerFn({ data: { id } });
}

export function removeServer(id: string) {
	return removeServerFn({ data: { id } });
}

export function renameServer(id: string, name: string) {
	return renameServerFn({ data: { id, name } });
}

export type ServerLimits = {
	cpuLimitCores: number;
	memLimitBytes: number;
	diskLimitBytes: number;
};

export function updateServerLimits(id: string, limits: ServerLimits) {
	return updateServerLimitsFn({ data: { id, ...limits } });
}

export function updateServerVariables(
	id: string,
	variables: Record<string, string>
) {
	return updateServerVariablesFn({ data: { id, variables } });
}

export function updateServerRuntime(id: string, imageLabel: string) {
	return updateServerRuntimeFn({ data: { id, imageLabel } });
}

/** Refresh every server feed after a mutation. */
export function invalidateServers(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["servers"] });
}

// ─── console ─────────────────────────────────────────────────────────────────

/** Mint a short-lived console JWT + the wss URL the browser opens to the daemon. */
export function mintServerToken(id: string) {
	return mintServerTokenFn({ data: { id } });
}

/** Send a console command to a server's container. */
export function sendServerCommand(id: string, command: string) {
	return sendServerCommandFn({ data: { id, command } });
}
