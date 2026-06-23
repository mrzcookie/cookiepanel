import type { FileEntry, FileTransfer } from "@/lib/domain/files";
import { requireOrg } from "@/server/auth/guards";
import type {
	DaemonDownloadJob,
	DaemonFileEntry,
} from "@/server/nodes/daemon-client";
import { serversRepository } from "@/server/servers/repository";

/**
 * Shared, server-only helpers for the file manager: the org+server scope guard
 * and the daemon→client projections. Imported by the `server/files` server
 * functions and the binary upload/download route handlers — never by the client
 * (the route handlers and the createServerFn handlers are the only callers).
 */

/**
 * Resolve a server scoped to the caller's active org and return the node it runs
 * on. Throws a **generic** not-found when the server is absent or in another org,
 * so cross-org ids are indistinguishable from missing ones (IDOR defense).
 */
export async function requireServerNode(
	serverId: string
): Promise<{ orgId: string; nodeId: string }> {
	const { orgId } = await requireOrg();
	const server = await serversRepository.findById(orgId, serverId);
	if (!server) {
		throw new Error("Not found");
	}
	return { orgId, nodeId: server.nodeId };
}

/** Project a daemon directory entry to the client-safe shape. */
export function toFileEntry(entry: DaemonFileEntry): FileEntry {
	return {
		path: entry.path,
		name: entry.name,
		// symlinks are surfaced as files: listed, but the daemon refuses to read or
		// follow them, so they're never navigable or editable.
		kind: entry.type === "dir" ? "directory" : "file",
		size: entry.size,
		modifiedAt: entry.modTime,
	};
}

/** Project a daemon URL-download job to the client-safe transfer snapshot. */
export function toFileTransfer(job: DaemonDownloadJob): FileTransfer {
	return {
		id: job.id,
		name: job.path.slice(job.path.lastIndexOf("/") + 1),
		state: job.state,
		total: job.total,
		done: job.done,
		error: job.error ?? null,
	};
}
