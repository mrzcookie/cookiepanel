import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Backup, BackupStatus } from "@/lib/domain/backups";
import type { DaemonRead } from "@/lib/domain/nodes";
import { formatRelativeTime } from "@/lib/format";
import { requireServerNode } from "@/server/files/service";
import {
	controlServerOnNode,
	createNodeBackup,
	type DaemonBackup,
	DaemonError,
	deleteNodeBackup,
	listNodeBackups,
	restoreNodeBackup,
	setNodeBackupLock,
} from "@/server/nodes/daemon-client";

/**
 * Backup server functions. Backups are **daemon-owned** (borg, in the box's
 * shared repo) — reads dial the node on demand and degrade to `{ ok: false }`
 * offline, like schedules/networks. Org-scoped via `requireServerNode` (generic
 * not-found). The daemon guards cross-server restore by archive ownership; this
 * layer additionally **stops the server before a restore** (it wipes the live
 * volume). Index-only (createServerFn exports).
 */

const STATUSES: BackupStatus[] = ["creating", "completed", "failed"];

function toBackup(d: DaemonBackup): Backup {
	const status = (STATUSES as string[]).includes(d.status)
		? (d.status as BackupStatus)
		: "completed";
	const hasTime = Boolean(d.createdAt) && !d.createdAt.startsWith("0001-");
	return {
		id: d.archive,
		serverId: d.serverId,
		name: d.name,
		createdAt:
			status === "creating" || !hasTime
				? null
				: formatRelativeTime(d.createdAt),
		sizeBytes: d.sizeBytes ?? 0,
		status,
		error: d.error ?? null,
		locked: d.locked,
	};
}

const idInput = z.object({
	serverId: z.uuid(),
	archive: z.string().min(1).max(128),
});

export const listServerBackups = createServerFn({ method: "GET" })
	.validator(z.object({ serverId: z.uuid() }))
	.handler(async ({ data }): Promise<DaemonRead<Backup[]>> => {
		const { nodeId } = await requireServerNode(data.serverId);
		try {
			const list = await listNodeBackups(nodeId, data.serverId);
			return { ok: true, data: list.map(toBackup) };
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

export const createBackup = createServerFn({ method: "POST" })
	.validator(
		z.object({
			serverId: z.uuid(),
			name: z.string().trim().max(100).default(""),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		return toBackup(await createNodeBackup(nodeId, data.serverId, data.name));
	});

export const restoreBackup = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		// Restore overwrites the live data volume, so stop the server first. A
		// missing/already-stopped container is fine — proceed to the restore.
		try {
			await controlServerOnNode(nodeId, data.serverId, "stop");
		} catch {
			// no running container — nothing to stop
		}
		await restoreNodeBackup(nodeId, data.serverId, data.archive);
		return { ok: true as const };
	});

export const setBackupLock = createServerFn({ method: "POST" })
	.validator(idInput.extend({ locked: z.boolean() }))
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await setNodeBackupLock(nodeId, data.serverId, data.archive, data.locked);
		return { ok: true as const };
	});

export const deleteBackup = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await deleteNodeBackup(nodeId, data.serverId, data.archive);
		return { archive: data.archive };
	});
