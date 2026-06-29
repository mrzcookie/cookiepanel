import { describe, expect, test } from "bun:test";
import {
	cancel,
	chunk,
	encodeFrame,
	errorFrame,
	event,
	type Frame,
	isFrame,
	parseFrame,
	request,
	result,
} from "./envelope";

// These canonical wire strings are pinned identically in the daemon's Go
// envelope test (apps/wings/internal/rpc/envelope_test.go). If the two ever
// diverge, one side's round-trip assertion fails — that's the cross-language
// conformance check.
const canonicalRequest = `{"kind":"req","id":"req-1","op":"createServer","payload":{"name":"mc"}}`;
const canonicalResult = `{"kind":"res","id":"req-1","payload":{"id":"srv-1"}}`;
const canonicalChunk = `{"kind":"chunk","id":"req-1","payload":{"line":"hello"}}`;
const canonicalError = `{"kind":"err","id":"req-1","error":{"code":"not_found","message":"server not found"}}`;
const canonicalCancel = `{"kind":"cancel","id":"req-1"}`;
const canonicalEvent = `{"kind":"event","op":"heartbeat","payload":{"ok":true}}`;

describe("envelope wire form", () => {
	test("encodes to the canonical bytes (matches the Go side)", () => {
		expect(encodeFrame(request("req-1", "createServer", { name: "mc" }))).toBe(
			canonicalRequest
		);
		expect(encodeFrame(result("req-1", { id: "srv-1" }))).toBe(canonicalResult);
		expect(encodeFrame(chunk("req-1", { line: "hello" }))).toBe(canonicalChunk);
		expect(
			encodeFrame(errorFrame("req-1", "not_found", "server not found"))
		).toBe(canonicalError);
		expect(encodeFrame(cancel("req-1"))).toBe(canonicalCancel);
		expect(encodeFrame(event("heartbeat", { ok: true }))).toBe(canonicalEvent);
	});

	test("a no-payload result omits the field", () => {
		expect(encodeFrame(result("req-1"))).toBe(`{"kind":"res","id":"req-1"}`);
	});
});

describe("parse + validate", () => {
	test("parses a canonical request and exposes its payload", () => {
		const f = parseFrame(canonicalRequest);
		expect(f.kind).toBe("req");
		if (f.kind === "req") {
			expect(f.id).toBe("req-1");
			expect(f.op).toBe("createServer");
			expect(f.payload).toEqual({ name: "mc" });
		}
	});

	test("round-trips every kind byte-for-byte", () => {
		for (const s of [
			canonicalRequest,
			canonicalResult,
			canonicalChunk,
			canonicalError,
			canonicalCancel,
			canonicalEvent,
		]) {
			expect(encodeFrame(parseFrame(s))).toBe(s);
		}
	});

	test("rejects malformed frames", () => {
		const bad = [
			`{"kind":"nope","id":"x"}`,
			`{"kind":"req","id":"x"}`, // missing op
			`{"kind":"req","op":"getSystem"}`, // missing id
			`{"kind":"err","id":"x"}`, // missing error
			`{"kind":"event"}`, // missing op
			`{"kind":"res"}`, // missing id
		];
		for (const s of bad) {
			expect(() => parseFrame(s)).toThrow();
		}
		expect(isFrame({ kind: "req", id: "x" })).toBe(false);
		expect(isFrame({ kind: "req", id: "x", op: "getSystem" })).toBe(true);
	});
});

describe("streaming sequence", () => {
	test("req → chunk → chunk → res keep the same id", () => {
		const id = "req-9";
		const frames: Frame[] = [
			request(id, "getSystemStats"),
			chunk(id, { cpu: 1 }),
			chunk(id, { cpu: 2 }),
			result(id),
		];
		for (const f of frames) {
			const back = parseFrame(encodeFrame(f));
			expect("id" in back ? back.id : undefined).toBe(id);
		}
	});
});
