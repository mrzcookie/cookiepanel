import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { NodeRow } from "@/lib/domain/nodes";
import { recordActivity } from "@/server/activity/record";
import { requireOrg } from "@/server/auth/guards";
import { assertCanAddNode, syncNodeBilling } from "@/server/billing/node-sync";
import { env } from "@/server/env";
import { type NodeRecord, nodesRepository } from "./repository";

/**
 * Nodes service + server functions — the typed boundary the UI calls (the UI
 * wiring itself is intentionally left for later). Each function is a thin
 * `auth + validate + delegate` shim: establish the org scope (`requireOrg`),
 * validate input (Zod), delegate to the org-scoped repository, and project to
 * the client-safe `NodeRow`. No SQL here; that stays in the repository.
 */

/**
 * Project a registry row to the client-safe `NodeRow` the UI renders. Live,
 * daemon-derived fields default to the "pending / never reported" shape until
 * the daemon lands and heartbeats are merged in here.
 */
function toNodeRow(record: NodeRecord): NodeRow {
	const caps =
		record.capCpuCores !== null &&
		record.capMemBytes !== null &&
		record.capDiskBytes !== null
			? {
					cpuCores: record.capCpuCores,
					memBytes: record.capMemBytes,
					diskBytes: record.capDiskBytes,
				}
			: null;

	return {
		id: record.id,
		name: record.name,
		fqdn: record.fqdn,
		daemonPort: record.daemonPort,
		managed: record.managed,
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
		caps,
	};
}

const createInput = z.object({
	name: z.string().trim().min(1).max(100),
	fqdn: z.string().trim().min(1).max(253),
	daemonPort: z.number().int().min(1).max(65535).default(8443),
	managed: z.boolean().default(false),
});

const idInput = z.object({ id: z.uuid() });

const updateInput = z.object({
	id: z.uuid(),
	name: z.string().trim().min(1).max(100).optional(),
	fqdn: z.string().trim().min(1).max(253).optional(),
	daemonPort: z.number().int().min(1).max(65535).optional(),
});

export const listNodes = createServerFn({ method: "GET" }).handler(async () => {
	const { orgId } = await requireOrg();
	const rows = await nodesRepository.list(orgId);
	return rows.map(toNodeRow);
});

export const getNode = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const record = await nodesRepository.findById(orgId, data.id);
		if (!record) {
			throw new Error("Not found");
		}
		return toNodeRow(record);
	});

export const createNode = createServerFn({ method: "POST" })
	.validator(createInput)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();

		// Entitlement gate: the org must be able to run another node before we
		// mint one. A no-op until Polar is configured; throws NodeBillingError
		// (a user-facing nudge) past the free first node otherwise.
		await assertCanAddNode(orgId);

		// Single-use bootstrap token: persist only its hash + expiry, and return
		// the plaintext exactly once (for the operator's install command). It is
		// never readable again — list/get never include it.
		const token = randomBytes(32).toString("base64url");
		const enrollmentTokenHash = createHash("sha256")
			.update(token)
			.digest("hex");
		const enrollmentTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

		const record = await nodesRepository.create(orgId, {
			name: data.name,
			fqdn: data.fqdn,
			daemonPort: data.daemonPort,
			managed: data.managed,
			enrollmentTokenHash,
			enrollmentTokenExpiresAt,
		});

		// Open the free-grant window on the first node, then bump the paid seat
		// count. No-op unless billing is configured.
		await syncNodeBilling(orgId);

		await recordActivity({
			category: "node",
			action: "node.created",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "node",
			targetId: record.id,
			targetLabel: record.name,
		});

		return {
			node: toNodeRow(record),
			enrollment: {
				token,
				expiresAt: enrollmentTokenExpiresAt.toISOString(),
				command: `curl -fsSL ${env.AUTH_URL}/install.sh | sh -s -- --token ${token}`,
			},
		};
	});

export const updateNode = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { id, ...patch } = data;
		const record = await nodesRepository.update(orgId, id, patch);
		if (!record) {
			throw new Error("Not found");
		}
		return toNodeRow(record);
	});

export const removeNode = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();
		const removed = await nodesRepository.remove(orgId, data.id);
		if (!removed) {
			throw new Error("Not found");
		}

		// Drop the paid seat count to match the smaller fleet. No-op unless billing
		// is configured / there's a paid subscription.
		await syncNodeBilling(orgId);

		await recordActivity({
			category: "node",
			action: "node.deleted",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "node",
			targetId: removed.id,
		});
		return { id: removed.id };
	});
