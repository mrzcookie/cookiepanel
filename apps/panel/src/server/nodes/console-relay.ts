import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { member } from "@/server/db/schema/auth";
import { serversRepository } from "@/server/servers/repository";
import { linkHub } from "./link-hub";

/**
 * The browser-facing console relay (Phase 5/6 of the transport inversion). The
 * browser opens a WebSocket to the PANEL (same origin, session cookie) instead
 * of dialing the box, and the panel streams the server's logs + stats down from
 * the daemon link as `chunk` frames. This works for every node regardless of its
 * cert — the browser only ever talks to the panel — fixing the old breakage
 * where a self-signed node's console never connected.
 *
 * Exported as plain crossws-shaped hooks; the route mounts them with the
 * framework's `defineWebSocketHandler` (the live upgrade is verified on a box).
 */

interface RelayPeer {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	request?: { url?: string; headers?: Headers };
	context: Record<string, unknown>;
}

/** Resolve the session + active org and confirm the server is in it; return its
 * node id (or null — the caller closes the socket, so a cross-org id leaks nothing). */
async function resolveNodeForServer(
	headers: Headers,
	serverId: string
): Promise<string | null> {
	const session = await auth.api.getSession({ headers });
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
	return server?.nodeId ?? null;
}

function serverIdFromPeer(peer: RelayPeer): string {
	const match = /\/api\/servers\/([^/]+)\/console/.exec(
		peer.request?.url ?? ""
	);
	return match?.[1] ?? "";
}

export const consoleRelayHooks = {
	async open(peer: RelayPeer): Promise<void> {
		const serverId = serverIdFromPeer(peer);
		const headers = peer.request?.headers;
		const nodeId =
			serverId && headers
				? await resolveNodeForServer(headers, serverId)
				: null;
		if (!nodeId || !linkHub.isConnected(nodeId)) {
			peer.close(1008, "unavailable");
			return;
		}
		peer.context.cancel = linkHub.stream(
			nodeId,
			"console",
			{ serverId },
			{
				onChunk: (payload) => peer.send(JSON.stringify(payload)),
				onError: (err) => {
					peer.send(JSON.stringify({ kind: "error", message: err.message }));
					peer.close();
				},
				onEnd: () => peer.close(),
			}
		);
	},

	close(peer: RelayPeer): void {
		(peer.context.cancel as (() => void) | undefined)?.();
	},
};
