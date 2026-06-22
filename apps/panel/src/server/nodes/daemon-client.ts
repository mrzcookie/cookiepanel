import { createHash } from "node:crypto";
import { Agent, request } from "node:https";
import type { TLSSocket } from "node:tls";
import { eq } from "drizzle-orm";
import type { NodeHostInfo, NodeLiveStats } from "@/lib/domain/nodes";
import { unseal } from "@/server/crypto";
import { db } from "@/server/db";
import { node, nodeCredential } from "@/server/db/schema/nodes";
import { nodeKeyAad } from "./enrollment";

/**
 * The typed boundary for panel → daemon HTTPS calls. The daemon serves a
 * self-signed cert, so we **pin** against the SHA-256 of the leaf's DER (recorded
 * on the node row at heartbeat) instead of trusting a CA; an "acme" sentinel
 * switches to normal trust-store verification. The Bearer token is the plaintext
 * node key, recovered by unsealing `nodeKeyCiphertext` under its node-bound AAD.
 *
 * Server-only (node:https, node:crypto, the DB, secret decryption). Callers must
 * have already established the org scope — this module dials a node by id and
 * does not re-check tenancy.
 */

const REQUEST_TIMEOUT_MS = 10_000;

// Sentinel the daemon reports (in the certFingerprint slot) when it serves a
// publicly-trusted Let's Encrypt cert instead of a self-signed one. Keep in sync
// with the daemon's tls mode.
const ACME_FINGERPRINT = "acme";

export class DaemonError extends Error {
	status?: number;
	body?: string;
	constructor(message: string, status?: number, body?: string) {
		super(message);
		this.name = "DaemonError";
		this.status = status;
		this.body = body;
	}
}

type NodeRef = {
	id: string;
	fqdn: string;
	daemonPort: number;
	certFingerprint: string;
};

/** Loads the node + credential, unseals the node key, returns the dial args. */
async function loadDialer(
	nodeId: string
): Promise<{ node: NodeRef; nodeKey: string }> {
	const [row] = await db
		.select({
			id: node.id,
			fqdn: node.fqdn,
			daemonPort: node.daemonPort,
			certFingerprint: node.certFingerprint,
			nodeKeyCiphertext: nodeCredential.nodeKeyCiphertext,
		})
		.from(node)
		.innerJoin(nodeCredential, eq(nodeCredential.nodeId, node.id))
		.where(eq(node.id, nodeId))
		.limit(1);

	if (!row) {
		throw new DaemonError(`node ${nodeId} not found`);
	}
	if (!row.certFingerprint) {
		throw new DaemonError(
			"node has no cert fingerprint yet (its daemon hasn't heartbeated since starting its API)"
		);
	}
	if (!row.nodeKeyCiphertext) {
		throw new DaemonError("node is not activated");
	}

	return {
		node: {
			id: row.id,
			fqdn: row.fqdn,
			daemonPort: row.daemonPort,
			certFingerprint: row.certFingerprint,
		},
		nodeKey: unseal(row.nodeKeyCiphertext, nodeKeyAad(row.id)),
	};
}

/**
 * An https.Agent for dialing a node.
 *
 * - ACME sentinel: a publicly-trusted cert, so verify against the system trust
 *   store + hostname (a public cert rotates on renewal — nothing stable to pin).
 * - self-signed (default): accept any cert at the TLS layer
 *   (`rejectUnauthorized:false` — the leaf is self-signed, so chain validation
 *   would reject it), and enforce the pin **manually** on the established socket
 *   in `daemonFetch`. Note: `checkServerIdentity` can't do this — with
 *   `rejectUnauthorized:false` Node records its error as `authorizationError` but
 *   does **not** abort the connection, so it provides no real enforcement.
 */
function pinningAgent(expected: string): Agent {
	if (expected === ACME_FINGERPRINT) {
		return new Agent({ rejectUnauthorized: true });
	}
	return new Agent({ rejectUnauthorized: false });
}

/** Aborts the request if the daemon's leaf cert doesn't match the pinned hash. */
function enforcePin(req: ReturnType<typeof request>, expected: string): void {
	req.on("socket", (socket) => {
		const tlsSocket = socket as TLSSocket;
		tlsSocket.on("secureConnect", () => {
			const cert = tlsSocket.getPeerCertificate();
			const actual = cert?.raw
				? createHash("sha256").update(cert.raw).digest("hex")
				: "";
			if (actual.toLowerCase() !== expected.toLowerCase()) {
				req.destroy(
					new DaemonError(
						`tls: cert fingerprint mismatch (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12) || "none"}…)`
					)
				);
			}
		});
	});
}

type DaemonFetchOptions = {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	body?: unknown;
	timeoutMs?: number;
};

/**
 * One HTTPS request to the daemon using cert-fingerprint pinning + Bearer
 * node-key auth. Throws `DaemonError` (with status + body) on non-2xx. Returns
 * parsed JSON when the response is JSON, the raw text otherwise.
 */
function daemonFetch(
	nodeKey: string,
	ref: NodeRef,
	opts: DaemonFetchOptions
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const payload = opts.body !== undefined ? JSON.stringify(opts.body) : "";
		const req = request(
			{
				host: ref.fqdn,
				port: ref.daemonPort,
				path: opts.path,
				method: opts.method ?? "GET",
				agent: pinningAgent(ref.certFingerprint),
				headers: {
					Authorization: `Bearer ${nodeKey}`,
					Accept: "application/json",
					...(payload
						? {
								"Content-Type": "application/json",
								"Content-Length": String(Buffer.byteLength(payload)),
							}
						: {}),
				},
				timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf8");
					const code = res.statusCode ?? 0;
					if (code < 200 || code >= 300) {
						reject(
							new DaemonError(
								`daemon ${opts.method ?? "GET"} ${opts.path}: HTTP ${code}`,
								code,
								raw.slice(0, 500)
							)
						);
						return;
					}
					const ct = res.headers["content-type"] ?? "";
					if (typeof ct === "string" && ct.includes("application/json")) {
						try {
							resolve(JSON.parse(raw));
						} catch (e) {
							reject(new DaemonError(`invalid JSON from daemon: ${e}`));
						}
					} else {
						resolve(raw);
					}
				});
			}
		);
		if (ref.certFingerprint !== ACME_FINGERPRINT) {
			enforcePin(req, ref.certFingerprint);
		}
		req.on("timeout", () => {
			req.destroy(new DaemonError("daemon request timed out"));
		});
		req.on("error", (err) => {
			// Surface the real TLS error (pin mismatch, etc.) — Node otherwise hides
			// it behind a generic ECONNRESET.
			const tlsMsg = (req.socket as TLSSocket | undefined)?.authorizationError;
			reject(
				new DaemonError(
					`daemon transport: ${err.message}${tlsMsg ? ` (${tlsMsg})` : ""}`
				)
			);
		});
		if (payload) {
			req.write(payload);
		}
		req.end();
	});
}

// Raw daemon JSON shapes (snake-ish keys as the Go side encodes them).
type StatsRaw = {
	cpuPct?: number;
	memUsedBytes?: number;
	memTotalBytes?: number;
	diskUsedBytes?: number;
	diskTotalBytes?: number;
	load1?: number;
	load5?: number;
	load15?: number;
};

type HostRaw = {
	hostname?: string;
	platform?: string;
	platformVersion?: string;
	kernel?: string;
	cpuModel?: string;
	cpuCount?: number;
	uptimeSeconds?: number;
};

/** GET /api/v1/system/stats — live CPU/memory/disk utilization. */
export async function getNodeStats(nodeId: string): Promise<NodeLiveStats> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const raw = (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/system/stats",
	})) as StatsRaw;
	return {
		cpuPercent: raw.cpuPct ?? 0,
		memUsedBytes: raw.memUsedBytes ?? 0,
		memTotalBytes: raw.memTotalBytes ?? 0,
		diskUsedBytes: raw.diskUsedBytes ?? 0,
		diskTotalBytes: raw.diskTotalBytes ?? 0,
		load1: raw.load1 ?? 0,
		load5: raw.load5 ?? 0,
		load15: raw.load15 ?? 0,
	};
}

/** GET /api/v1/system/host — slow-changing host details. */
export async function getNodeHost(nodeId: string): Promise<NodeHostInfo> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const raw = (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/system/host",
	})) as HostRaw;
	return {
		hostname: raw.hostname ?? "",
		platform: raw.platform ?? "",
		platformVersion: raw.platformVersion ?? "",
		kernel: raw.kernel ?? "",
		cpuModel: raw.cpuModel ?? "",
		cpuCount: raw.cpuCount ?? 0,
		uptimeSeconds: raw.uptimeSeconds ?? 0,
	};
}
