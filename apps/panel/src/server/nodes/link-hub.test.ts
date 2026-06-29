import { describe, expect, test } from "bun:test";
import {
	chunk,
	encodeFrame,
	errorFrame,
	parseFrame,
	result,
} from "@raptor/contract/envelope";
import { type ControlResponse, type LinkConnection, linkHub } from "./link-hub";

// A fake socket that records what the hub sends and lets the test reply.
class FakeConn implements LinkConnection {
	sent: string[] = [];
	closed = false;
	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.closed = true;
	}
	/** The id the hub assigned to the most recent request. */
	lastId(): string {
		const frame = parseFrame(this.sent.at(-1) as string);
		return "id" in frame ? frame.id : "";
	}
}

describe("link hub", () => {
	test("correlates a response to its request", async () => {
		const node = "node-correlate";
		const conn = new FakeConn();
		linkHub.register(node, conn);

		const pending = linkHub.request(node, {
			method: "GET",
			path: "/api/v1/system",
		});
		// The hub sent a `req` frame carrying the control request.
		const sent = parseFrame(conn.sent[0] as string);
		expect(sent.kind).toBe("req");
		if (sent.kind === "req") {
			expect(sent.payload).toEqual({ method: "GET", path: "/api/v1/system" });
		}

		// Reply over the socket; the promise resolves with the daemon's response.
		const reply: ControlResponse = { status: 200, body: `{"ok":true}` };
		linkHub.handleMessage(node, encodeFrame(result(conn.lastId(), reply)));
		await expect(pending).resolves.toEqual(reply);

		linkHub.unregister(node);
	});

	test("rejects on an error frame", async () => {
		const node = "node-err";
		const conn = new FakeConn();
		linkHub.register(node, conn);
		const pending = linkHub.request(node, { method: "GET", path: "/x" });
		linkHub.handleMessage(
			node,
			encodeFrame(errorFrame(conn.lastId(), "not_found", "nope"))
		);
		await expect(pending).rejects.toThrow(/not_found: nope/);
		linkHub.unregister(node);
	});

	test("times out when the daemon never replies", async () => {
		const node = "node-timeout";
		linkHub.register(node, new FakeConn());
		await expect(
			linkHub.request(node, { method: "GET", path: "/x" }, 10)
		).rejects.toThrow(/timed out/);
		linkHub.unregister(node);
	});

	test("a reconnect supersedes the old socket and fails its in-flight calls", async () => {
		const node = "node-reconnect";
		const first = new FakeConn();
		linkHub.register(node, first);
		const stale = linkHub.request(node, { method: "GET", path: "/x" });

		// A new socket arrives for the same node.
		linkHub.register(node, new FakeConn());
		await expect(stale).rejects.toThrow(/superseded/);
		expect(linkHub.isConnected(node)).toBe(true);
		linkHub.unregister(node);
		expect(linkHub.isConnected(node)).toBe(false);
	});

	test("requesting an unknown node rejects", async () => {
		await expect(
			linkHub.request("nobody", { method: "GET", path: "/x" })
		).rejects.toThrow(/no daemon link/);
	});

	test("streams chunk frames to onChunk, then onEnd", () => {
		const node = "node-stream";
		const conn = new FakeConn();
		linkHub.register(node, conn);

		const chunks: unknown[] = [];
		let ended = false;
		linkHub.stream(
			node,
			"console",
			{ serverId: "srv-1" },
			{
				onChunk: (p) => chunks.push(p),
				onEnd: () => {
					ended = true;
				},
			}
		);
		// The hub sent a `req` with the stream op + payload.
		const sent = parseFrame(conn.sent[0] as string);
		expect(sent.kind).toBe("req");
		if (sent.kind === "req") {
			expect(sent.op).toBe("console");
		}
		const id = conn.lastId();

		linkHub.handleMessage(node, encodeFrame(chunk(id, { line: "a" })));
		linkHub.handleMessage(node, encodeFrame(chunk(id, { line: "b" })));
		linkHub.handleMessage(node, encodeFrame(result(id)));

		expect(chunks).toEqual([{ line: "a" }, { line: "b" }]);
		expect(ended).toBe(true);
		linkHub.unregister(node);
	});

	test("cancel sends a cancel frame and stops delivering chunks", () => {
		const node = "node-stream-cancel";
		const conn = new FakeConn();
		linkHub.register(node, conn);

		const chunks: unknown[] = [];
		const cancel = linkHub.stream(node, "console", null, {
			onChunk: (p) => chunks.push(p),
		});
		const id = conn.lastId();
		linkHub.handleMessage(node, encodeFrame(chunk(id, { line: "a" })));
		cancel();
		// A cancel frame went out, and a late chunk is ignored.
		const last = parseFrame(conn.sent.at(-1) as string);
		expect(last.kind).toBe("cancel");
		linkHub.handleMessage(node, encodeFrame(chunk(id, { line: "late" })));

		expect(chunks).toEqual([{ line: "a" }]);
		linkHub.unregister(node);
	});
});
