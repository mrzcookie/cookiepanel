import type { ServerRow, ServerState } from "@/lib/domain/servers";
import { createStore } from "@/lib/store";
import { SERVERS } from "@/lib/stubs";

// Mutable client-side stub store for servers — a stand-in for the data layer.
// The servers list and a server's detail tabs are separate routes, so they can't
// share one component's state; this module is the single source of truth they
// both read, so power actions, rename, limit edits, and delete reflect
// everywhere. Mutations happen only in the browser; the server snapshot stays
// the seeded stub (so SSR and the first client render agree). Power changes are
// simulated with a short transition (starting → running) so the flow feels real;
// replaced wholesale when the real daemon-driven data lands.

const store = createStore<ServerRow[]>(SERVERS);

export function useServers() {
	return store.use();
}

export function useServer(id: string) {
	return useServers().find((server) => server.id === id);
}

// — State coherence ———————————————————————————————————————————————————————————
// Live readouts (cpu / memory / uptime) only make sense while a container runs,
// so they're seeded on the way into `running` and cleared on the way out. Disk
// usage persists across power changes (the data volume stays on the box).

function patchForState(server: ServerRow, state: ServerState): ServerRow {
	if (state === "running") {
		return {
			...server,
			state,
			cpuPercent: server.cpuPercent ?? 6,
			memUsedBytes:
				server.memUsedBytes ?? Math.round(server.memLimitBytes * 0.3),
			uptimeSeconds: server.uptimeSeconds ?? 0,
		};
	}
	// starting / installing / stopped / failed: nothing live to report yet.
	return {
		...server,
		state,
		cpuPercent: null,
		memUsedBytes: null,
		uptimeSeconds: null,
	};
}

function setState(id: string, state: ServerState) {
	store.set(
		store
			.get()
			.map((server) =>
				server.id === id ? patchForState(server, state) : server
			)
	);
}

// Pending state transitions, so a second action (or a delete) cancels the first.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(id: string) {
	const pending = timers.get(id);
	if (pending) {
		clearTimeout(pending);
		timers.delete(id);
	}
}

function transition(
	id: string,
	immediate: ServerState,
	eventual: ServerState,
	delayMs: number
) {
	clearTimer(id);
	setState(id, immediate);
	timers.set(
		id,
		setTimeout(() => {
			timers.delete(id);
			setState(id, eventual);
		}, delayMs)
	);
}

// — Power ——————————————————————————————————————————————————————————————————————

export function startServer(id: string) {
	transition(id, "starting", "running", 1400);
}

export function restartServer(id: string) {
	transition(id, "starting", "running", 1600);
}

export function stopServer(id: string) {
	clearTimer(id);
	setState(id, "stopped");
}

export function reinstallServer(id: string) {
	transition(id, "installing", "running", 2600);
}

// — Create —————————————————————————————————————————————————————————————————————

export type NewServer = {
	name: string;
	templateId: string;
	templateName: string;
	imageLabel: string;
	nodeId: string;
	nodeName: string;
	nodeAddress: string;
	/** Primary published port (its allocation is created alongside by the caller). */
	port: number;
	cpuLimitCores: number;
	memLimitBytes: number;
	diskLimitBytes: number;
	/** Player-set values, envVariable → value. Secrets are never stored here. */
	variables: Record<string, string>;
};

/**
 * Deploy a server from a template. It lands `installing` (no live readouts yet),
 * then converges to `running` on a short delay — standing in for the daemon's
 * real install pipeline. The caller also reserves the port allocation and bumps
 * the template's server count, mirroring the eventual provision flow.
 */
export function addServer(input: NewServer): ServerRow {
	const server: ServerRow = {
		id: crypto.randomUUID(),
		name: input.name.trim(),
		templateName: input.templateName,
		templateId: input.templateId,
		imageLabel: input.imageLabel,
		updateAvailable: false,
		state: "installing",
		nodeId: input.nodeId,
		nodeName: input.nodeName,
		nodeAddress: input.nodeAddress,
		// Null until the bind exists — the published port appears when it converges
		// to running (the allocation is reserved separately, by the caller).
		port: null,
		cpuPercent: null,
		memUsedBytes: null,
		cpuLimitCores: input.cpuLimitCores,
		memLimitBytes: input.memLimitBytes,
		diskUsedBytes: null,
		diskLimitBytes: input.diskLimitBytes,
		uptimeSeconds: null,
		createdAt: "Just now",
		variables: input.variables,
		lastError: null,
	};
	store.set([server, ...store.get()]);
	// Simulate install → running, binding the published port on the way.
	clearTimer(server.id);
	setState(server.id, "installing");
	timers.set(
		server.id,
		setTimeout(() => {
			timers.delete(server.id);
			store.set(
				store
					.get()
					.map((current) =>
						current.id === server.id
							? patchForState({ ...current, port: input.port }, "running")
							: current
					)
			);
		}, 2600)
	);
	return server;
}

// — Edits ——————————————————————————————————————————————————————————————————————

export function renameServer(id: string, name: string) {
	store.set(
		store
			.get()
			.map((server) =>
				server.id === id ? { ...server, name: name.trim() } : server
			)
	);
}

export type ServerLimits = {
	cpuLimitCores: number;
	memLimitBytes: number;
	diskLimitBytes: number;
};

export function updateServerLimits(id: string, limits: ServerLimits) {
	store.set(
		store
			.get()
			.map((server) => (server.id === id ? { ...server, ...limits } : server))
	);
}

export function updateServerVariables(
	id: string,
	variables: Record<string, string>
) {
	store.set(
		store
			.get()
			.map((server) => (server.id === id ? { ...server, variables } : server))
	);
}

/**
 * Switch a server to a different runtime from its template's image list. Stores
 * the friendly label (never a raw image string); the daemon would recreate the
 * container on the new image, applied on the next restart.
 */
export function updateServerRuntime(id: string, imageLabel: string) {
	store.set(
		store
			.get()
			.map((server) => (server.id === id ? { ...server, imageLabel } : server))
	);
}

export function deleteServer(id: string) {
	clearTimer(id);
	store.set(store.get().filter((server) => server.id !== id));
}
