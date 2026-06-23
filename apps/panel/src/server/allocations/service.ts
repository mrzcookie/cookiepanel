import type { AllocationProtocol, AllocationRow } from "@/lib/domain/networks";
import { setFirewallPort } from "@/server/nodes/daemon-client";
import { type AllocationRecord, allocationsRepository } from "./repository";

/**
 * Allocation helpers shared by the allocation server fns and the server
 * lifecycle. Server-only (touches the daemon-client + repository) — kept out of
 * the `index.ts` createServerFn surface so nothing here leaks to the client.
 *
 * Firewall changes ride in lockstep with allocations but are **best-effort**: a
 * noop/unavailable firewall (dev, or a box without ufw/iptables) must never block
 * reserving or releasing a port.
 */

export function toAllocationRow(
	record: AllocationRecord,
	serverName: string | null
): AllocationRow {
	return {
		id: record.id,
		nodeId: record.nodeId,
		ip: record.ip,
		port: record.port,
		protocol: record.protocol,
		serverId: record.serverId,
		serverName,
	};
}

async function openFirewall(
	nodeId: string,
	port: number,
	protocol: AllocationProtocol
): Promise<void> {
	try {
		await setFirewallPort(nodeId, port, protocol, "open");
	} catch {
		// firewall unavailable / unsupported — the allocation still stands.
	}
}

export async function closeFirewall(
	nodeId: string,
	port: number,
	protocol: AllocationProtocol
): Promise<void> {
	try {
		await setFirewallPort(nodeId, port, protocol, "close");
	} catch {
		// firewall unavailable / unsupported / protected-port — ignore.
	}
}

/**
 * Reserve a port slot and open the firewall. Throws on a `(node, port, protocol)`
 * conflict (the DB unique index) — callers map that to a friendly "port in use".
 */
export async function reserveAllocation(
	orgId: string,
	nodeId: string,
	serverId: string | null,
	port: number,
	protocol: AllocationProtocol,
	ip = "0.0.0.0"
): Promise<AllocationRecord> {
	const row = await allocationsRepository.create(orgId, {
		nodeId,
		serverId,
		ip,
		port,
		protocol,
	});
	await openFirewall(nodeId, port, protocol);
	return row;
}

/**
 * Close the firewall for each of a server's allocations. Call this before
 * deleting the server — the allocation rows themselves cascade away with it.
 */
export async function releaseServerFirewall(
	orgId: string,
	serverId: string
): Promise<void> {
	const rows = await allocationsRepository.listByServer(orgId, serverId);
	for (const r of rows) {
		await closeFirewall(r.nodeId, r.port, r.protocol);
	}
}
