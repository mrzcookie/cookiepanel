import { useSyncExternalStore } from "react";
import {
	portInUse,
	releaseAllocation as releaseAllocationById,
	addAllocation as reserveAllocation,
	useNodeAllocations,
} from "@/lib/allocations-store";
import {
	type AllocationProtocol,
	DRIVES,
	FIREWALL,
	type FirewallRow,
} from "@/lib/stubs";

// Mutable client-side stub stores for the daemon-derived per-node resources that
// the node detail tabs now manage: port allocations, firewall, and drives. Same
// shape as networks-store/nodes-store — replaced wholesale when the data layer
// lands. Mutations happen only in the browser; the server snapshot stays seeded.

function createStore<T>(seed: T[]) {
	let items = seed;
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	const get = () => items;
	const set = (next: T[]) => {
		items = next;
		for (const listener of listeners) {
			listener();
		}
	};
	const use = () => useSyncExternalStore(subscribe, get, get);
	return { get, set, use };
}

// — Port allocations ——————————————————————————————————————————————————————————
// Allocations live in the shared allocations-store so the node's Networking tab
// and a server's Network tab read and write one source of truth — a port
// reserved in either place is visible (and can't be double-bound) in the other.
// These thin wrappers keep the node-side call shape over that store.

export function useAllocations(nodeId: string) {
	return useNodeAllocations(nodeId);
}

/** Reserve a free node-side slot (no server yet). False when already in use. */
export function addAllocation(
	nodeId: string,
	input: { ip: string; port: number; protocol: AllocationProtocol }
): boolean {
	if (portInUse(nodeId, input.port, input.protocol)) {
		return false;
	}
	reserveAllocation({ nodeId, serverId: null, serverName: null, ...input });
	return true;
}

export function releaseAllocation(id: string) {
	releaseAllocationById(id);
}

// — Firewall ——————————————————————————————————————————————————————————————————

const firewall = createStore(FIREWALL);

export function useFirewall(nodeId: string): FirewallRow | undefined {
	return firewall.use().find((row) => row.nodeId === nodeId);
}

/** Returns false (no-op) when the port/protocol is already open. */
export function addFirewallRule(
	nodeId: string,
	rule: { port: number; protocol: AllocationProtocol }
): boolean {
	const row = firewall.get().find((entry) => entry.nodeId === nodeId);
	if (
		!row ||
		row.rules.some((r) => r.port === rule.port && r.protocol === rule.protocol)
	) {
		return false;
	}
	firewall.set(
		firewall
			.get()
			.map((entry) =>
				entry.nodeId === nodeId
					? { ...entry, rules: [...entry.rules, rule] }
					: entry
			)
	);
	return true;
}

export function removeFirewallRule(
	nodeId: string,
	port: number,
	protocol: AllocationProtocol
) {
	firewall.set(
		firewall.get().map((row) =>
			row.nodeId === nodeId
				? {
						...row,
						rules: row.rules.filter(
							(r) => !(r.port === port && r.protocol === protocol)
						),
					}
				: row
		)
	);
}

export function setFirewallActive(nodeId: string, active: boolean) {
	firewall.set(
		firewall
			.get()
			.map((row) => (row.nodeId === nodeId ? { ...row, active } : row))
	);
}

// — Drives ————————————————————————————————————————————————————————————————————

const drives = createStore(DRIVES);

export function useDrives(nodeId: string) {
	return drives.use().filter((row) => row.nodeId === nodeId);
}

export function formatDrive(
	id: string,
	filesystem: string,
	mountpoint: string
) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id ? { ...row, filesystem, mountpoint, usedBytes: 0 } : row
			)
	);
}

export function mountDrive(id: string, mountpoint: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id
					? { ...row, mountpoint, usedBytes: row.usedBytes ?? 0 }
					: row
			)
	);
}

export function unmountDrive(id: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id
					? { ...row, isDataTarget: false, mountpoint: null, usedBytes: null }
					: row
			)
	);
}

export function setDataTarget(nodeId: string, id: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.nodeId === nodeId ? { ...row, isDataTarget: row.id === id } : row
			)
	);
}
