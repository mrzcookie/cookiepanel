import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	deleteNodeFile,
	getNodeUrlDownload,
	listNodeFiles,
	mkdirNodeFile,
	readNodeFile,
	renameNodeFile,
	startNodeUrlDownload,
	writeNodeFile,
} from "@/server/nodes/daemon-client";
import { requireServerNode, toFileEntry, toFileTransfer } from "./service";

/**
 * Per-server file-manager server functions: thin `auth + validate + delegate`
 * shims over the daemon's sandboxed file API. Every call resolves the server's
 * node scoped to the caller's org first (`requireServerNode`); the daemon
 * sandboxes each path to the server's data volume. Binary upload/download go
 * through the `routes/api/files/*` route handlers instead (they stream).
 *
 * Index-only: this module exports nothing but `createServerFn` values, so the
 * client bundle never pulls in the DB/daemon client (see the server-fn rules).
 */

const serverPath = z.object({
	serverId: z.uuid(),
	path: z.string().max(4096),
});

export const listFiles = createServerFn({ method: "GET" })
	.validator(z.object({ serverId: z.uuid(), path: z.string().max(4096) }))
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		const entries = await listNodeFiles(nodeId, data.serverId, data.path);
		return entries.map(toFileEntry);
	});

export const readFile = createServerFn({ method: "GET" })
	.validator(serverPath)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		return { content: await readNodeFile(nodeId, data.serverId, data.path) };
	});

export const writeFile = createServerFn({ method: "POST" })
	.validator(
		z.object({
			serverId: z.uuid(),
			path: z.string().max(4096),
			content: z.string(),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await writeNodeFile(nodeId, data.serverId, data.path, data.content);
		return { ok: true as const };
	});

/** Create an empty file (a write of no bytes). */
export const createFile = createServerFn({ method: "POST" })
	.validator(serverPath)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await writeNodeFile(nodeId, data.serverId, data.path, "");
		return { ok: true as const };
	});

export const createDirectory = createServerFn({ method: "POST" })
	.validator(serverPath)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await mkdirNodeFile(nodeId, data.serverId, data.path);
		return { ok: true as const };
	});

export const renameEntry = createServerFn({ method: "POST" })
	.validator(
		z.object({
			serverId: z.uuid(),
			from: z.string().max(4096),
			to: z.string().max(4096),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await renameNodeFile(nodeId, data.serverId, data.from, data.to);
		return { ok: true as const };
	});

/** Move a path into the server's recycle bin (the daemon's delete = trash). */
export const deleteEntry = createServerFn({ method: "POST" })
	.validator(serverPath)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await deleteNodeFile(nodeId, data.serverId, data.path);
		return { ok: true as const };
	});

/** Kick off an async URL pull on the box; returns the job id to poll. */
export const pullUrl = createServerFn({ method: "POST" })
	.validator(
		z.object({
			serverId: z.uuid(),
			path: z.string().max(4096),
			url: z.string().url().max(2048),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		const jobId = await startNodeUrlDownload(
			nodeId,
			data.serverId,
			data.path,
			data.url
		);
		return { jobId };
	});

export const urlJobStatus = createServerFn({ method: "GET" })
	.validator(z.object({ serverId: z.uuid(), jobId: z.string().max(128) }))
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		return toFileTransfer(
			await getNodeUrlDownload(nodeId, data.serverId, data.jobId)
		);
	});
