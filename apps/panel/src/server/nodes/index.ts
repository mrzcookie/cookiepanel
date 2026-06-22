import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
	DaemonRead,
	NodeHostInfo,
	NodeLiveStats,
	NodeRow,
	NodeStatus,
} from "@/lib/domain/nodes";
import { formatRelativeTime } from "@/lib/format";
import { NODES_DOMAIN } from "@/lib/node-domain";
import { slugify } from "@/lib/slug";
import { recordActivity } from "@/server/activity/record";
import { requireOrg } from "@/server/auth/guards";
import { assertCanAddNode, syncNodeBilling } from "@/server/billing/node-sync";
import { sha256Hex } from "@/server/crypto";
import { env } from "@/server/env";
import { DaemonError, getNodeHost, getNodeStats } from "./daemon-client";
import { reconcileManagedNodeDns } from "./dns";
import { type NodeRecord, nodesRepository } from "./repository";

/**
 * Nodes service + server functions — the typed boundary the UI calls (via
 * `lib/node-queries`). Each function is a thin `auth + validate + delegate`
 * shim: establish the org scope (`requireOrg`), validate input (Zod), delegate
 * to the org-scoped repository, and project to the client-safe `NodeRow`. No
 * SQL here; that stays in the repository.
 */

// A node is "online" only while its last heartbeat is recent; older than a few
// missed beats (the daemon beats every ~30s) it's stale → offline. No heartbeat
// yet → still pending.
const HEARTBEAT_STALE_MS = 90_000;

function deriveStatus(lastHeartbeatAt: Date | null): NodeStatus {
	if (!lastHeartbeatAt) {
		return "pending";
	}
	return Date.now() - lastHeartbeatAt.getTime() < HEARTBEAT_STALE_MS
		? "online"
		: "offline";
}

function normalizeArch(arch: string | undefined): NodeRow["arch"] {
	if (arch === "amd64" || arch === "x86_64") {
		return "x86_64";
	}
	if (arch === "arm64" || arch === "aarch64") {
		return "arm64";
	}
	return null;
}

/**
 * Project a registry row to the client-safe `NodeRow` the UI renders. The
 * daemon-derived fields are merged from the heartbeat's `systemInfo` (null until
 * the box first reports), and status is derived from the last heartbeat. Live
 * usage (cpu%/mem/disk used, real server counts) arrives on the stats channel in
 * a later slice, so it stays null here.
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

	const sys = record.systemInfo;
	const docker = sys?.docker;

	return {
		id: record.id,
		name: record.name,
		fqdn: record.fqdn,
		daemonPort: record.daemonPort,
		managed: record.managed,
		status: deriveStatus(record.lastHeartbeatAt),
		publicIp: record.publicIp,
		os: sys?.os ?? null,
		arch: normalizeArch(sys?.arch),
		cpuCores: sys?.cpus ?? null,
		memTotalBytes: sys?.memTotalBytes ?? null,
		diskTotalBytes: sys?.diskTotalBytes ?? null,
		cpuPercent: null,
		memUsedBytes: null,
		diskUsedBytes: null,
		serversRunning: docker?.running ?? null,
		serversTotal: docker?.containers ?? null,
		daemonVersion: sys?.daemonVersion ?? null,
		updateAvailable: false,
		lastHeartbeat: record.lastHeartbeatAt
			? formatRelativeTime(record.lastHeartbeatAt)
			: null,
		caps,
	};
}

const createInput = z.object({
	name: z.string().trim().min(1).max(100),
	// Required for an operator-pointed node; ignored for a managed one, whose
	// address the panel owns and derives server-side from the base domain.
	fqdn: z.string().trim().min(1).max(253).optional(),
	daemonPort: z.number().int().min(1).max(65535).default(8443),
	managed: z.boolean().default(false),
});

const idInput = z.object({ id: z.uuid() });

const updateInput = z.object({
	id: z.uuid(),
	name: z.string().trim().min(1).max(100).optional(),
	fqdn: z.string().trim().min(1).max(253).optional(),
	daemonPort: z.number().int().min(1).max(65535).optional(),
	// Operator-set allocatable ceilings. Bounded against detected hardware in the
	// UI; only reachable once the daemon reports that hardware, so this stays
	// dormant in the registry-only phase. Mapped to the cap_* columns below.
	caps: z
		.object({
			cpuCores: z.number().int().min(1),
			memBytes: z.number().int().min(1),
			diskBytes: z.number().int().min(1),
		})
		.optional(),
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

		// Resolve the address. A managed node's subdomain is panel-owned: derive it
		// from the node name + configured base domain and ignore any client value,
		// so the operator can't redirect the panel at an address it doesn't control.
		// An operator-pointed node keeps the address they gave.
		let fqdn: string;
		let daemonPort: number;
		if (data.managed) {
			const slug = slugify(data.name);
			if (!slug) {
				throw new Error("Node name must include a letter or number.");
			}
			fqdn = `${slug}.${NODES_DOMAIN}`;
			daemonPort = 8443;
		} else {
			if (!data.fqdn) {
				throw new Error("An address is required.");
			}
			fqdn = data.fqdn;
			daemonPort = data.daemonPort;
		}

		// Single-use bootstrap token: persist only its hash + expiry (in the
		// sibling node_credential row), and return the plaintext exactly once — for
		// the operator's install command. It's never readable again.
		const token = `bst_${randomBytes(32).toString("base64url")}`;
		const bootstrapExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

		const record = await nodesRepository.create(
			orgId,
			{ name: data.name, fqdn, daemonPort, managed: data.managed },
			{ bootstrapTokenHash: sha256Hex(token), bootstrapExpiresAt }
		);

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

		// The one-line install command carries everything the daemon's `configure`
		// needs: the panel URL, the node id, the single-use token, and the address.
		return {
			node: toNodeRow(record),
			enrollment: {
				token,
				expiresAt: bootstrapExpiresAt.toISOString(),
				command: `curl -fsSL ${env.AUTH_URL}/install.sh | sudo sh -s -- --panel ${env.AUTH_URL} --node ${record.id} --token ${token} --fqdn ${fqdn}`,
			},
		};
	});

export const updateNode = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { id, caps, ...patch } = data;
		const record = await nodesRepository.update(orgId, id, {
			...patch,
			...(caps
				? {
						capCpuCores: caps.cpuCores,
						capMemBytes: caps.memBytes,
						capDiskBytes: caps.diskBytes,
					}
				: {}),
		});
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

		// Tear down the panel-managed subdomain's DNS record. Best-effort + a no-op
		// unless Cloudflare is configured; operator-pointed nodes own their own DNS,
		// so we never touch those.
		if (removed.managed) {
			await reconcileManagedNodeDns(removed.fqdn, null);
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

// ─── live daemon reads (on-demand, degrade gracefully) ───────────────────────
// Registry reads (above) never touch the box; these dial the daemon over the
// pinned HTTPS channel. Org scope is established first (generic not-found), then
// the call is wrapped so an unreachable box reads back as `{ ok: false }` rather
// than erroring the page.

export const nodeStats = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }): Promise<DaemonRead<NodeLiveStats>> => {
		const { orgId } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.id))) {
			throw new Error("Not found");
		}
		try {
			return { ok: true, data: await getNodeStats(data.id) };
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof DaemonError
						? error.message
						: "Could not reach the node",
			};
		}
	});

export const nodeHost = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }): Promise<DaemonRead<NodeHostInfo>> => {
		const { orgId } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.id))) {
			throw new Error("Not found");
		}
		try {
			return { ok: true, data: await getNodeHost(data.id) };
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof DaemonError
						? error.message
						: "Could not reach the node",
			};
		}
	});
