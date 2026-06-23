import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { member } from "@/server/db/schema/auth";
import { openNodeDownload, uploadNodeFile } from "@/server/nodes/daemon-client";
import { serversRepository } from "@/server/servers/repository";

/**
 * Binary file upload/download for the file manager. These stream raw bytes
 * (octet-stream), which `createServerFn` doesn't model, so they're plain server
 * route handlers (`routes/api/files/*`) instead. Each re-establishes the org +
 * server scope from the request's session cookie — defense in depth, the same
 * guard the server functions get from `requireServerNode`, just keyed off the
 * passed request rather than the server-fn context.
 *
 * Server-only: pulls in the DB, auth, and the daemon client. Imported by the
 * route handlers only.
 */

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the server scoped to the request's active org, re-querying membership
 * (the cookie-cached active-org can go stale). Returns the node id, or null when
 * unauthenticated / not a member / the server isn't in the org — callers turn
 * null into a generic 404 so cross-org ids can't be probed.
 */
async function resolveServerNode(
	request: Request,
	serverId: string
): Promise<{ nodeId: string } | null> {
	const session = await auth.api.getSession({ headers: request.headers });
	if (!session) {
		return null;
	}
	const orgId = session.session.activeOrganizationId;
	if (!orgId) {
		return null;
	}
	const [membership] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(eq(member.userId, session.user.id), eq(member.organizationId, orgId))
		)
		.limit(1);
	if (!membership) {
		return null;
	}
	const server = await serversRepository.findById(orgId, serverId);
	if (!server) {
		return null;
	}
	return { nodeId: server.nodeId };
}

function badRequest(message: string): Response {
	return new Response(message, { status: 400 });
}

/** GET /api/files/download?serverId=…&path=… — streams the file to the browser. */
export async function downloadForRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const serverId = url.searchParams.get("serverId") ?? "";
	const path = url.searchParams.get("path") ?? "";
	if (!UUID_RE.test(serverId) || path === "") {
		return badRequest("serverId and path are required");
	}
	const scope = await resolveServerNode(request, serverId);
	if (!scope) {
		return new Response("Not found", { status: 404 });
	}
	try {
		const { stream, filename, contentLength } = await openNodeDownload(
			scope.nodeId,
			serverId,
			path
		);
		const headers = new Headers({
			"Content-Type": "application/octet-stream",
			"Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
		});
		if (contentLength) {
			headers.set("Content-Length", contentLength);
		}
		// Bridge the node response stream to a web ReadableStream for the Response.
		const body = Readable.toWeb(stream) as NodeWebReadableStream<Uint8Array>;
		return new Response(body as unknown as ReadableStream, { headers });
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : "Download failed",
			{ status: 502 }
		);
	}
}

/** POST /api/files/upload?serverId=…&path=… — writes the request body to path. */
export async function uploadForRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const serverId = url.searchParams.get("serverId") ?? "";
	const path = url.searchParams.get("path") ?? "";
	if (!UUID_RE.test(serverId) || path === "") {
		return badRequest("serverId and path are required");
	}
	const scope = await resolveServerNode(request, serverId);
	if (!scope) {
		return new Response("Not found", { status: 404 });
	}
	try {
		const body = Buffer.from(await request.arrayBuffer());
		await uploadNodeFile(scope.nodeId, serverId, path, body);
		return new Response(null, { status: 204 });
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : "Upload failed",
			{ status: 502 }
		);
	}
}
