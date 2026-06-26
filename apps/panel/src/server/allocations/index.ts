import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { recordActivity } from "@/server/activity/record";
import { requireOrg } from "@/server/auth/guards";
import { nodesRepository } from "@/server/nodes/repository";
import { serversRepository } from "@/server/servers/repository";
import { allocationsRepository } from "./repository";
import { closeFirewall, reserveAllocation, toAllocationRow } from "./service";

/**
 * Port-allocation server functions. Allocations are the panel-owned port
 * registry; reads are org+node-scoped DB queries, and create/remove drive the
 * daemon's firewall in lockstep. Thin `auth + validate + delegate` shims.
 */

const idInput = z.object({ id: z.uuid() });

export const listServerAllocations = createServerFn({ method: "GET" })
	.validator(z.object({ serverId: z.uuid() }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const server = await serversRepository.findById(orgId, data.serverId);
		if (!server) {
			return [];
		}
		const rows = await allocationsRepository.listByServer(orgId, data.serverId);
		return rows.map((row) => toAllocationRow(row, server.name));
	});

export const listNodeAllocations = createServerFn({ method: "GET" })
	.validator(z.object({ nodeId: z.uuid() }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.nodeId))) {
			return [];
		}
		const [rows, servers] = await Promise.all([
			allocationsRepository.listByNode(orgId, data.nodeId),
			serversRepository.listByNode(orgId, data.nodeId),
		]);
		const names = new Map(servers.map((s) => [s.id, s.name]));
		return rows.map((row) =>
			toAllocationRow(
				row,
				row.serverId ? (names.get(row.serverId) ?? null) : null
			)
		);
	});

export const createAllocation = createServerFn({ method: "POST" })
	.validator(
		z.object({
			nodeId: z.uuid(),
			port: z.number().int().min(1).max(65535),
			protocol: z.enum(["tcp", "udp"]).default("tcp"),
			ip: z.string().trim().min(1).max(45).default("0.0.0.0"),
		})
	)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.nodeId))) {
			throw new Error("Not found");
		}
		let row: Awaited<ReturnType<typeof reserveAllocation>>;
		try {
			row = await reserveAllocation(
				orgId,
				data.nodeId,
				null,
				data.port,
				data.protocol,
				data.ip
			);
		} catch {
			// The (node, port, protocol) unique index rejected it.
			throw new Error("That port is already allocated on this node.");
		}
		await recordActivity({
			category: "node",
			action: "allocation.created",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "node",
			targetId: data.nodeId,
			targetLabel: `${data.port}/${data.protocol}`,
		});
		return toAllocationRow(row, null);
	});

export const removeAllocation = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const row = await allocationsRepository.findById(orgId, data.id);
		if (!row) {
			throw new Error("Not found");
		}
		// A slot assigned to a server can't be released (domain.md): freeing the
		// port out from under a running server would break its networking.
		if (row.serverId) {
			throw new Error(
				"This port is assigned to a server and can't be released."
			);
		}
		await closeFirewall(row.nodeId, row.port, row.protocol);
		await allocationsRepository.remove(orgId, data.id);
		return { id: data.id };
	});
