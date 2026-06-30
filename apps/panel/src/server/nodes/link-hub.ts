import {
	cancel as cancelFrame,
	encodeFrame,
	type Frame,
	request as newRequest,
	parseFrame,
} from "@raptor/contract/envelope";

/**
 * The in-process registry of live daemon WebSocket links (Phase 4 of the
 * panel↔daemon transport inversion). Each managed box dials IN to the panel and
 * holds one socket here; the panel's `daemon-client` sends a control request
 * over it and awaits the correlated reply, instead of dialing an inbound HTTPS
 * port. Single-instance only — one Bun process owns every link (see DEPLOY.md);
 * scaling out would need a backplane.
 *
 * This module is transport-agnostic: it drives an abstract {@link LinkConnection}
 * (the WebSocket adapter feeds it bytes and supplies `send`/`close`), so the
 * correlation logic is unit-testable without a real socket.
 */

/** The minimal connection the hub drives — implemented by the WS peer adapter. */
export interface LinkConnection {
	send(data: string): void;
	close(): void;
}

/** A daemon-relative HTTP request tunnelled to the box (mirrors Go's ControlRequest). */
export interface ControlRequest {
	method: string;
	path: string;
	/** Raw request body (a JSON string, or base64 for a binary upload). */
	body?: string;
	/** "base64" when `body` is base64-encoded binary, omitted for a plain body. */
	encoding?: "base64";
}

/** The daemon's response (mirrors Go's ControlResponse). */
export interface ControlResponse {
	status: number;
	body: string;
	/** "base64" when `body` is base64-encoded binary (a download). */
	encoding?: "base64";
	/** Response headers the panel needs (content-type/-disposition/-length). */
	headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** The op label on control frames — the daemon dispatches by method+path, not op. */
const CONTROL_OP = "control";

interface Pending {
	resolve: (r: ControlResponse) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/** Callbacks for a streaming op (the live console): chunk-by-chunk, then end. */
export interface StreamHandlers {
	onChunk: (payload: unknown) => void;
	onEnd?: () => void;
	onError?: (err: Error) => void;
}

/** One live link to a single node. */
class Connection {
	private readonly pending = new Map<string, Pending>();
	private readonly streams = new Map<string, StreamHandlers>();
	private seq = 0;

	constructor(private readonly conn: LinkConnection) {}

	private nextId(): string {
		return `${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
	}

	request(cr: ControlRequest, timeoutMs: number): Promise<ControlResponse> {
		const id = this.nextId();
		return new Promise<ControlResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("daemon link request timed out"));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.conn.send(encodeFrame(newRequest(id, CONTROL_OP, cr)));
			} catch (err) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	/** Open a streaming op; returns a function that cancels it. */
	stream(op: string, payload: unknown, handlers: StreamHandlers): () => void {
		const id = this.nextId();
		this.streams.set(id, handlers);
		try {
			this.conn.send(encodeFrame(newRequest(id, op, payload)));
		} catch (err) {
			this.streams.delete(id);
			handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
			return () => {};
		}
		return () => {
			if (this.streams.delete(id)) {
				try {
					this.conn.send(encodeFrame(cancelFrame(id)));
				} catch {
					// the socket is already gone; nothing to cancel
				}
			}
		};
	}

	/** Feed one inbound frame (raw wire text) from the socket. */
	handle(data: string): void {
		let frame: Frame;
		try {
			frame = parseFrame(data);
		} catch {
			return; // drop malformed frames
		}
		switch (frame.kind) {
			case "chunk":
				this.streams.get(frame.id)?.onChunk(frame.payload);
				break;
			case "res": {
				const stream = this.streams.get(frame.id);
				if (stream) {
					this.streams.delete(frame.id);
					stream.onEnd?.();
					break;
				}
				this.settle(frame.id, (p) =>
					p.resolve(
						(frame.payload as ControlResponse | undefined) ?? {
							status: 502,
							body: "",
						}
					)
				);
				break;
			}
			case "err": {
				const message = `daemon link error: ${frame.error.code}: ${frame.error.message}`;
				const stream = this.streams.get(frame.id);
				if (stream) {
					this.streams.delete(frame.id);
					stream.onError?.(new Error(message));
					break;
				}
				this.settle(frame.id, (p) => p.reject(new Error(message)));
				break;
			}
			default:
				// `event` (heartbeat/notifications) and any req/cancel inbound to the
				// panel are ignored — the panel is the requester on this channel.
				break;
		}
	}

	private settle(id: string, fn: (p: Pending) => void): void {
		const p = this.pending.get(id);
		if (!p) {
			return;
		}
		this.pending.delete(id);
		clearTimeout(p.timer);
		fn(p);
	}

	/** Fail every in-flight request and stream — the socket is gone. */
	closeAll(reason: string): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(new Error(reason));
		}
		this.pending.clear();
		for (const [, s] of this.streams) {
			s.onError?.(new Error(reason));
		}
		this.streams.clear();
	}

	/** Fail in-flight work and close the underlying socket. */
	shutdown(reason: string): void {
		this.closeAll(reason);
		try {
			this.conn.close();
		} catch {
			// already gone
		}
	}
}

interface Entry {
	instanceId: number;
	conn: Connection;
}

class LinkHub {
	private readonly conns = new Map<string, Entry>();
	private seq = 0;

	/**
	 * Register a node's socket, superseding any prior one (a reconnect). Returns
	 * an instance id the WS handler threads back into handleMessage/unregister so
	 * a stale socket's late frames or close can't disturb a fresh connection.
	 */
	register(nodeId: string, conn: LinkConnection): number {
		this.unregister(nodeId, undefined, "superseded by a new connection");
		const instanceId = ++this.seq;
		this.conns.set(nodeId, { instanceId, conn: new Connection(conn) });
		return instanceId;
	}

	/**
	 * Drop a node's socket and fail its in-flight work. If instanceId is given,
	 * only drops when it's the *current* connection — so the old socket's delayed
	 * close (after a reconnect already registered a new one) is a no-op.
	 */
	unregister(
		nodeId: string,
		instanceId?: number,
		reason = "daemon link closed"
	): void {
		const entry = this.conns.get(nodeId);
		if (!entry) {
			return;
		}
		if (instanceId !== undefined && entry.instanceId !== instanceId) {
			return;
		}
		entry.conn.shutdown(reason);
		this.conns.delete(nodeId);
	}

	/** Feed one inbound frame for a node — ignored unless it's the current socket. */
	handleMessage(nodeId: string, instanceId: number, data: string): void {
		const entry = this.conns.get(nodeId);
		if (entry && entry.instanceId === instanceId) {
			entry.conn.handle(data);
		}
	}

	/** Whether a node currently has a live link (the panel uses it iff so). */
	isConnected(nodeId: string): boolean {
		return this.conns.has(nodeId);
	}

	/** Tunnel one control request to a node and await its reply. */
	request(
		nodeId: string,
		cr: ControlRequest,
		timeoutMs: number = DEFAULT_TIMEOUT_MS
	): Promise<ControlResponse> {
		const entry = this.conns.get(nodeId);
		if (!entry) {
			return Promise.reject(new Error(`no daemon link for node ${nodeId}`));
		}
		return entry.conn.request(cr, timeoutMs);
	}

	/**
	 * Open a streaming op (the live console) on a node; chunk payloads flow to
	 * `handlers.onChunk` until the stream ends. Returns a cancel function (call it
	 * when the browser disconnects). Throws if the node has no live link.
	 */
	stream(
		nodeId: string,
		op: string,
		payload: unknown,
		handlers: StreamHandlers
	): () => void {
		const entry = this.conns.get(nodeId);
		if (!entry) {
			throw new Error(`no daemon link for node ${nodeId}`);
		}
		return entry.conn.stream(op, payload, handlers);
	}
}

// Module-level singleton. Cached on globalThis so dev HMR re-evaluating this
// module doesn't orphan live links behind a fresh registry.
const globalForHub = globalThis as unknown as { __raptorLinkHub?: LinkHub };
export const linkHub: LinkHub = globalForHub.__raptorLinkHub ?? new LinkHub();
globalForHub.__raptorLinkHub = linkHub;
