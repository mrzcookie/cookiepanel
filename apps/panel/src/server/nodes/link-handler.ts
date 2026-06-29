import { authenticateNodeKey } from "./enrollment";
import { type LinkConnection, linkHub } from "./link-hub";

/**
 * The daemon-facing WebSocket endpoint hooks: the box dials IN here, and on
 * connect we authenticate its node key, register the socket with the link hub,
 * and feed inbound frames to it. This is the panel half of the dial-home
 * transport (the daemon half is apps/wings/internal/link).
 *
 * The hooks are exported as a plain crossws-shaped object (no direct h3/crossws
 * import, to avoid pinning a second copy of those packages) — the route that
 * mounts the WebSocket wraps them with the framework's `defineWebSocketHandler`.
 *
 * NOTE: the live upgrade + the Nitro/bun mounting are verified on a real box —
 * this is the panel↔daemon trust boundary, exercised end-to-end there. The hub
 * and the daemon-client transport swap are unit/type tested off-box.
 */

// crossws's Peer/Message types vary across versions; pin only what we touch.
interface LinkPeer {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	request?: { headers?: { get(name: string): string | null } };
	context: Record<string, unknown>;
}
interface LinkMessage {
	text(): string;
}

function bearer(peer: LinkPeer): string | null {
	const header = peer.request?.headers?.get("authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const daemonLinkHooks = {
	async open(peer: LinkPeer): Promise<void> {
		const key = bearer(peer);
		const nodeId = key ? await authenticateNodeKey(key) : null;
		if (!nodeId) {
			peer.close(1008, "unauthorized");
			return;
		}
		peer.context.nodeId = nodeId;
		const conn: LinkConnection = {
			send: (data) => peer.send(data),
			close: () => peer.close(),
		};
		linkHub.register(nodeId, conn);
	},

	message(peer: LinkPeer, message: LinkMessage): void {
		const nodeId = peer.context.nodeId as string | undefined;
		if (nodeId) {
			linkHub.handleMessage(nodeId, message.text());
		}
	},

	close(peer: LinkPeer): void {
		const nodeId = peer.context.nodeId as string | undefined;
		if (nodeId) {
			linkHub.unregister(nodeId);
		}
	},
};
