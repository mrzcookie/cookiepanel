import { useSyncExternalStore } from "react";
import { SERVERS, type ServerRow, type ServerState } from "@/lib/stubs";

// Mutable client-side stub store for servers — a stand-in for the data layer.
// The servers list and a server's detail tabs are separate routes, so they can't
// share one component's state; this module is the single source of truth they
// both read, so power actions, rename, limit edits, and delete reflect
// everywhere. Mutations happen only in the browser; the server snapshot stays
// the seeded stub (so SSR and the first client render agree). Power changes are
// simulated with a short transition (starting → running) so the flow feels real;
// replaced wholesale when the real daemon-driven data lands.

let servers: ServerRow[] = SERVERS;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return servers;
}

export function useServers() {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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
	servers = servers.map((server) =>
		server.id === id ? patchForState(server, state) : server
	);
	emit();
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

/** Force-kill: same end state as stop, but immediate and ungraceful. */
export function killServer(id: string) {
	clearTimer(id);
	setState(id, "stopped");
}

export function reinstallServer(id: string) {
	transition(id, "installing", "running", 2600);
}

// — Edits ——————————————————————————————————————————————————————————————————————

export function renameServer(id: string, name: string) {
	servers = servers.map((server) =>
		server.id === id ? { ...server, name: name.trim() } : server
	);
	emit();
}

export type ServerLimits = {
	cpuLimitCores: number;
	memLimitBytes: number;
	diskLimitBytes: number;
};

export function updateServerLimits(id: string, limits: ServerLimits) {
	servers = servers.map((server) =>
		server.id === id ? { ...server, ...limits } : server
	);
	emit();
}

export function updateServerVariables(
	id: string,
	variables: Record<string, string>
) {
	servers = servers.map((server) =>
		server.id === id ? { ...server, variables } : server
	);
	emit();
}

export function deleteServer(id: string) {
	clearTimer(id);
	servers = servers.filter((server) => server.id !== id);
	emit();
}
