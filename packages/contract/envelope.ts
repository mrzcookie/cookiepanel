import type { operations } from "./gen/contract";

/**
 * The framing for the panel↔daemon WebSocket transport: a small, hand-written
 * envelope that carries the contract's operations (by their `operationId`) as
 * typed JSON frames over one persistent socket.
 *
 * It is deliberately NOT generated from the OpenAPI spec. The spec models
 * request/response *payloads*; this envelope is the meta-protocol around them
 * (correlation, multiplexing, streaming, cancellation) — the same reason the
 * browser console WebSocket was never modelled in the spec. A frame's `payload`
 * is whatever the operation's contract type says it is; the op-typing helpers
 * below recover that type from the generated `operations`.
 *
 * The wire form is mirrored byte-for-byte by the daemon's Go envelope
 * (apps/wings/internal/rpc/envelope.go). Both round-trip tests pin the identical
 * canonical JSON, so the two can't drift.
 *
 * Lifecycle: a requester sends a `req` frame; the responder streams zero or more
 * `chunk` frames, then exactly one terminal `res` (success) or `err` (failure).
 * A unary op skips the chunks. `cancel` aborts an in-flight op (the responder
 * ends it with an `err` of code `canceled`). `event` is an unsolicited,
 * uncorrelated push (heartbeat, async notifications) — no id, no response.
 */

/**
 * The envelope version. Exchanged once in the connection handshake (not stamped
 * on every frame); bump it on a breaking change to the framing.
 */
export const PROTOCOL_VERSION = 1;

export type FrameKind = "req" | "res" | "chunk" | "err" | "cancel" | "event";

/** A small, transport-level error taxonomy the panel maps to its own semantics. */
export type RpcErrorCode =
	| "bad_request"
	| "not_found"
	| "unsupported"
	| "timeout"
	| "canceled"
	| "internal";

export interface RpcError {
	code: RpcErrorCode;
	message: string;
}

export interface RequestFrame<P = unknown> {
	kind: "req";
	id: string;
	op: string;
	payload?: P;
}
export interface ResultFrame<P = unknown> {
	kind: "res";
	id: string;
	payload?: P;
}
export interface ChunkFrame<P = unknown> {
	kind: "chunk";
	id: string;
	payload?: P;
}
export interface ErrorFrame {
	kind: "err";
	id: string;
	error: RpcError;
}
export interface CancelFrame {
	kind: "cancel";
	id: string;
}
export interface EventFrame<P = unknown> {
	kind: "event";
	op: string;
	payload?: P;
}

export type Frame =
	| RequestFrame
	| ResultFrame
	| ChunkFrame
	| ErrorFrame
	| CancelFrame
	| EventFrame;

// ── Op registry — the operationIds reused as the RPC namespace ───────────────

/** Every operationId in the contract — the RPC op namespace. */
export type OperationId = keyof operations;

type JsonBody<T> = T extends { content: { "application/json": infer B } }
	? B
	: undefined;

/** The JSON request body for an operation (`undefined` when it takes none). */
export type OpRequest<Op extends OperationId> = operations[Op] extends {
	requestBody: infer R;
}
	? JsonBody<R>
	: undefined;

/** The JSON success-response body for an operation (`undefined` when it returns none). */
export type OpResponse<Op extends OperationId> =
	operations[Op]["responses"] extends infer R
		? R extends { 200: infer X }
			? JsonBody<X>
			: R extends { 201: infer X }
				? JsonBody<X>
				: undefined
		: undefined;

/** A request frame whose `op` + `payload` are checked against the contract. */
export interface TypedRequest<Op extends OperationId> {
	kind: "req";
	id: string;
	op: Op;
	payload: OpRequest<Op>;
}
/** A result frame whose `payload` is checked against the contract. */
export interface TypedResult<Op extends OperationId> {
	kind: "res";
	id: string;
	payload: OpResponse<Op>;
}

// ── Constructors — build frames in the canonical field order ─────────────────
// Field order (kind, id, op, payload, error) and omission of empty fields match
// the Go struct's JSON, so `encodeFrame` is byte-identical across the two sides.

export function request<P>(
	id: string,
	op: string,
	payload?: P
): RequestFrame<P> {
	return payload === undefined
		? { kind: "req", id, op }
		: { kind: "req", id, op, payload };
}

export function result<P>(id: string, payload?: P): ResultFrame<P> {
	return payload === undefined
		? { kind: "res", id }
		: { kind: "res", id, payload };
}

export function chunk<P>(id: string, payload?: P): ChunkFrame<P> {
	return payload === undefined
		? { kind: "chunk", id }
		: { kind: "chunk", id, payload };
}

export function errorFrame(
	id: string,
	code: RpcErrorCode,
	message: string
): ErrorFrame {
	return { kind: "err", id, error: { code, message } };
}

export function cancel(id: string): CancelFrame {
	return { kind: "cancel", id };
}

export function event<P>(op: string, payload?: P): EventFrame<P> {
	return payload === undefined
		? { kind: "event", op }
		: { kind: "event", op, payload };
}

// ── Validation + (de)serialization ───────────────────────────────────────────

const ERROR_CODES: ReadonlySet<string> = new Set<RpcErrorCode>([
	"bad_request",
	"not_found",
	"unsupported",
	"timeout",
	"canceled",
	"internal",
]);

function isRpcError(value: unknown): value is RpcError {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const e = value as Record<string, unknown>;
	return (
		typeof e.code === "string" &&
		ERROR_CODES.has(e.code) &&
		typeof e.message === "string"
	);
}

/** Runtime type guard enforcing the per-kind structural invariants. */
export function isFrame(value: unknown): value is Frame {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const f = value as Record<string, unknown>;
	const hasId = typeof f.id === "string" && f.id !== "";
	const hasOp = typeof f.op === "string" && f.op !== "";
	switch (f.kind) {
		case "req":
			return hasId && hasOp;
		case "res":
		case "chunk":
		case "cancel":
			return hasId;
		case "err":
			return hasId && isRpcError(f.error);
		case "event":
			return hasOp;
		default:
			return false;
	}
}

/** Parse a frame off the wire, throwing on anything malformed. */
export function parseFrame(data: string): Frame {
	const value: unknown = JSON.parse(data);
	if (!isFrame(value)) {
		throw new Error("rpc: malformed frame");
	}
	return value;
}

/** Serialize a frame to its wire bytes. */
export function encodeFrame(frame: Frame): string {
	return JSON.stringify(frame);
}
