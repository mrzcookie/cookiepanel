import { useSyncExternalStore } from "react";
import {
	ALLOCATIONS,
	type AllocationProtocol,
	type AllocationRow,
} from "@/lib/stubs";

// Mutable client-side stub store for port allocations — panel-owned registry
// (not daemon-derived). A node's free/assigned port slots; the firewall opens
// and closes in lockstep with these. The server's Network tab and (eventually)
// the node's Networking tab read from here so allocate / release reflect in both.
// Mutations are browser-only; the seeded snapshot is what SSR renders. Replaced
// when the real data layer lands.

let allocations: AllocationRow[] = ALLOCATIONS;
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
	return allocations;
}

export function useAllocations() {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useServerAllocations(serverId: string) {
	return useAllocations().filter(
		(allocation) => allocation.serverId === serverId
	);
}

export function useNodeAllocations(nodeId: string) {
	return useAllocations().filter((allocation) => allocation.nodeId === nodeId);
}

/** Whether a port/protocol is already allocated on a node (can't double-bind). */
export function portInUse(
	nodeId: string,
	port: number,
	protocol: AllocationProtocol
): boolean {
	return allocations.some(
		(allocation) =>
			allocation.nodeId === nodeId &&
			allocation.port === port &&
			allocation.protocol === protocol
	);
}

export type NewAllocation = {
	nodeId: string;
	/** null when the slot is reserved on a node but not yet held by a server. */
	serverId: string | null;
	serverName: string | null;
	ip: string;
	port: number;
	protocol: AllocationProtocol;
};

export function addAllocation(input: NewAllocation): AllocationRow {
	const allocation: AllocationRow = {
		id: crypto.randomUUID(),
		nodeId: input.nodeId,
		ip: input.ip,
		port: input.port,
		protocol: input.protocol,
		serverId: input.serverId,
		serverName: input.serverName,
	};
	allocations = [...allocations, allocation];
	emit();
	return allocation;
}

export function releaseAllocation(id: string) {
	allocations = allocations.filter((allocation) => allocation.id !== id);
	emit();
}
