import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Agent, request } from "node:https";
import type { TLSSocket } from "node:tls";
import type { components } from "@cookiepanel/contract";
import { eq } from "drizzle-orm";
import type { NodeHostInfo, NodeLiveStats } from "@/lib/domain/nodes";
import { unseal } from "@/server/crypto";
import { db } from "@/server/db";
import { node, nodeCredential } from "@/server/db/schema/nodes";
import { nodeKeyAad } from "./enrollment";

// The daemon wire types are the OpenAPI contract's generated schemas — the spec
// (packages/contract/openapi.yaml) is the single source of truth, so these are
// aliases, not hand-written duplicates. Request/response shapes both come from
// `components["schemas"]`. (Conformance is now structural: tsc resolves the alias.)
type Schemas = components["schemas"];

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

type DaemonStreamOptions = {
	method: "GET" | "POST";
	path: string;
	body?: Buffer;
	contentType?: string;
	timeoutMs?: number;
};

/**
 * Like `daemonFetch` but for **binary** bodies/responses (file upload/download):
 * resolves with the live response stream once headers arrive (no buffering), so
 * the caller can pipe it straight through. A non-2xx response is buffered and
 * rejected as a `DaemonError`. Same pinning + Bearer auth as `daemonFetch`.
 */
function daemonStream(
	nodeKey: string,
	ref: NodeRef,
	opts: DaemonStreamOptions
): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: ref.fqdn,
				port: ref.daemonPort,
				path: opts.path,
				method: opts.method,
				agent: pinningAgent(ref.certFingerprint),
				headers: {
					Authorization: `Bearer ${nodeKey}`,
					...(opts.body
						? {
								"Content-Type": opts.contentType ?? "application/octet-stream",
								"Content-Length": String(opts.body.byteLength),
							}
						: {}),
				},
				timeout: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
			},
			(res) => {
				const code = res.statusCode ?? 0;
				if (code < 200 || code >= 300) {
					const chunks: Buffer[] = [];
					res.on("data", (c: Buffer) => chunks.push(c));
					res.on("end", () => {
						reject(
							new DaemonError(
								`daemon ${opts.method} ${opts.path}: HTTP ${code}`,
								code,
								Buffer.concat(chunks).toString("utf8").slice(0, 500)
							)
						);
					});
					return;
				}
				resolve(res);
			}
		);
		if (ref.certFingerprint !== ACME_FINGERPRINT) {
			enforcePin(req, ref.certFingerprint);
		}
		req.on("timeout", () => {
			req.destroy(new DaemonError("daemon request timed out"));
		});
		req.on("error", (err) => {
			const tlsMsg = (req.socket as TLSSocket | undefined)?.authorizationError;
			reject(
				new DaemonError(
					`daemon transport: ${err.message}${tlsMsg ? ` (${tlsMsg})` : ""}`
				)
			);
		});
		if (opts.body) {
			req.write(opts.body);
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

// ─── host maintenance ────────────────────────────────────────────────────────

// Reboot/restart return fast (202). A daemon self-update downloads + verifies the
// new binary synchronously before announcing success, so it can run for minutes.
const DAEMON_UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/** POST /api/v1/system/reboot — reboot the whole host. */
export async function rebootNode(nodeId: string): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/system/reboot",
	});
}

/** POST /api/v1/system/prune — free disk (dangling images + build cache only). */
export async function pruneNode(
	nodeId: string
): Promise<{ imagesDeleted: number; spaceReclaimedBytes: number }> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/system/prune",
	})) as { imagesDeleted: number; spaceReclaimedBytes: number };
}

/** POST /api/v1/system/restart-daemon — restart the cookied agent (via systemd). */
export async function restartNodeDaemon(nodeId: string): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/system/restart-daemon",
	});
}

/** POST /api/v1/system/update-daemon — download+verify+swap the binary, then restart. */
export async function updateNodeDaemon(
	nodeId: string,
	url: string,
	sha256: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/system/update-daemon",
		body: { url, sha256 },
		timeoutMs: DAEMON_UPDATE_TIMEOUT_MS,
	});
}

// ─── drives ────────────────────────────────────────────────────────────────────

// Formatting and the Docker-data-root relocation shell out to mkfs / `systemctl
// restart docker`, which run well past the default 10s.
const DRIVE_OP_TIMEOUT_MS = 5 * 60 * 1000;

/** The daemon's view of one physical disk. */
export type DaemonDrive = Schemas["Drive"];

export async function listNodeDrives(nodeId: string): Promise<DaemonDrive[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/drives",
	})) as DaemonDrive[];
}

export async function formatNodeDrive(
	nodeId: string,
	device: string,
	filesystem: string,
	mountpoint: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/drives/format",
		body: { device, filesystem, mountpoint },
		timeoutMs: DRIVE_OP_TIMEOUT_MS,
	});
}

export async function mountNodeDrive(
	nodeId: string,
	device: string,
	mountpoint: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/drives/mount",
		body: { device, mountpoint },
	});
}

export async function unmountNodeDrive(
	nodeId: string,
	device: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/drives/unmount",
		body: { device },
	});
}

export async function setNodeDataTarget(
	nodeId: string,
	device: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/drives/data-target",
		body: { device },
		timeoutMs: DRIVE_OP_TIMEOUT_MS,
	});
}

// ─── servers (container lifecycle) ───────────────────────────────────────────

// An image pull (+ first start) can take minutes; the default 10s timeout would
// abort it.
const SERVER_CREATE_TIMEOUT_MS = 5 * 60 * 1000;

/** The daemon's snapshot of a server. `state`/`status` are Docker's raw values;
 * `error` carries the failure detail when state is "failed" (e.g. a non-zero
 * install script). State may also be the panel-side transient "installing". */
export type DaemonServer = Schemas["Server"];

/** What the panel POSTs to create a container. */
export type DaemonServerSpec = Schemas["CreateServerRequest"];

export async function createServerOnNode(
	nodeId: string,
	spec: DaemonServerSpec
): Promise<DaemonServer> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/servers",
		body: spec,
		timeoutMs: SERVER_CREATE_TIMEOUT_MS,
	})) as DaemonServer;
}

export async function getServerOnNode(
	nodeId: string,
	serverId: string
): Promise<DaemonServer> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: `/api/v1/servers/${serverId}`,
	})) as DaemonServer;
}

export async function controlServerOnNode(
	nodeId: string,
	serverId: string,
	action: "start" | "stop" | "restart"
): Promise<DaemonServer> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `/api/v1/servers/${serverId}/${action}`,
		// stop/restart wait out Docker's graceful-stop grace (SIGTERM → SIGKILL)
		// before the container actually halts, so allow more than the default 10s.
		timeoutMs: 30_000,
	})) as DaemonServer;
}

export async function deleteServerOnNode(
	nodeId: string,
	serverId: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "DELETE",
		path: `/api/v1/servers/${serverId}`,
	});
}

export async function sendCommandOnNode(
	nodeId: string,
	serverId: string,
	command: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `/api/v1/servers/${serverId}/command`,
		body: { command },
	});
}

// ─── networks ────────────────────────────────────────────────────────────────

export type DaemonNetwork = Schemas["Network"];

export type DaemonNetworkSpec = Schemas["CreateNetworkRequest"];

export async function getNodeNetworks(
	nodeId: string
): Promise<DaemonNetwork[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/networks",
	})) as DaemonNetwork[];
}

export async function createNetworkOnNode(
	nodeId: string,
	spec: DaemonNetworkSpec
): Promise<DaemonNetwork> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/networks",
		body: spec,
	})) as DaemonNetwork;
}

export async function deleteNetworkOnNode(
	nodeId: string,
	networkId: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "DELETE",
		path: `/api/v1/networks/${networkId}`,
	});
}

export async function setNetworkAttachment(
	nodeId: string,
	networkId: string,
	serverId: string,
	action: "attach" | "detach"
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `/api/v1/networks/${networkId}/${action}`,
		body: { serverId },
	});
}

// ─── firewall ────────────────────────────────────────────────────────────────

export type DaemonFirewall = Schemas["FirewallStatus"];

export async function getNodeFirewall(nodeId: string): Promise<DaemonFirewall> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/firewall",
	})) as DaemonFirewall;
}

export async function setFirewallPort(
	nodeId: string,
	port: number,
	protocol: string,
	action: "open" | "close"
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `/api/v1/firewall/${action}`,
		body: { port, protocol },
	});
}

// ─── files ───────────────────────────────────────────────────────────────────

// A URL pull can fetch a large server jar; give the start call room beyond 10s
// (the fetch itself runs async on the box — only the start handshake is timed).
const FILE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** One entry in a daemon directory listing. */
export type DaemonFileEntry = Schemas["FileEntry"];

/** The daemon's snapshot of an in-flight (or finished) URL-download job. */
export type DaemonDownloadJob = Schemas["DownloadJob"];

const filesBase = (serverId: string) => `/api/v1/servers/${serverId}/files`;
const withPath = (base: string, path: string) =>
	`${base}?path=${encodeURIComponent(path)}`;

export async function listNodeFiles(
	nodeId: string,
	serverId: string,
	path: string
): Promise<DaemonFileEntry[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: withPath(`${filesBase(serverId)}/list`, path),
	})) as DaemonFileEntry[];
}

export async function readNodeFile(
	nodeId: string,
	serverId: string,
	path: string
): Promise<string> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const res = (await daemonFetch(nodeKey, ref, {
		path: withPath(`${filesBase(serverId)}/read`, path),
	})) as { content: string };
	return res.content;
}

export async function writeNodeFile(
	nodeId: string,
	serverId: string,
	path: string,
	content: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/write`,
		body: { path, content },
	});
}

export async function mkdirNodeFile(
	nodeId: string,
	serverId: string,
	path: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/mkdir`,
		body: { path },
	});
}

export async function renameNodeFile(
	nodeId: string,
	serverId: string,
	from: string,
	to: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/rename`,
		body: { from, to },
	});
}

/** Moves the path into the server's recycle bin (the daemon's delete = trash). */
export async function deleteNodeFile(
	nodeId: string,
	serverId: string,
	path: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/delete`,
		body: { path },
	});
}

export async function startNodeUrlDownload(
	nodeId: string,
	serverId: string,
	path: string,
	url: string
): Promise<string> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const res = (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/url-download`,
		body: { path, url },
	})) as { jobId: string };
	return res.jobId;
}

export async function getNodeUrlDownload(
	nodeId: string,
	serverId: string,
	jobId: string
): Promise<DaemonDownloadJob> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: `${filesBase(serverId)}/url-download/${jobId}`,
	})) as DaemonDownloadJob;
}

/** Packs `paths` into a new archive at `dest` (format: zip / tar.gz / tar.xz / …). */
export async function archiveNodeFiles(
	nodeId: string,
	serverId: string,
	paths: string[],
	dest: string,
	format: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/archive`,
		body: { paths, dest, format },
		// Compressing a large directory can take a while.
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
}

/** Extracts the archive at `path` into `dest` (format auto-detected on the box). */
export async function extractNodeFile(
	nodeId: string,
	serverId: string,
	path: string,
	dest: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${filesBase(serverId)}/extract`,
		body: { path, dest },
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
}

// ─── sftp sessions ─────────────────────────────────────────────────────────

/** A freshly-minted SFTP credential (the password is only returned here, once). */
export type DaemonSftpMint = Schemas["SftpMintResponse"];

/** The non-secret status of a server's SFTP session. */
export type DaemonSftpStatus = Schemas["SftpStatusResponse"];

const sftpPath = (serverId: string) => `/api/v1/servers/${serverId}/sftp`;

export async function mintSftpSession(
	nodeId: string,
	serverId: string
): Promise<DaemonSftpMint> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: sftpPath(serverId),
	})) as DaemonSftpMint;
}

export async function getSftpSession(
	nodeId: string,
	serverId: string
): Promise<DaemonSftpStatus> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: sftpPath(serverId),
	})) as DaemonSftpStatus;
}

export async function revokeSftpSession(
	nodeId: string,
	serverId: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "DELETE",
		path: sftpPath(serverId),
	});
}

// ─── schedules ─────────────────────────────────────────────────────────────

/** One step in a daemon schedule (flat, type-discriminated). */
export type DaemonScheduleStep = Schemas["ScheduleStep"];

/** The daemon's schedule shape (cron-native; one record per automation). */
export type DaemonSchedule = Schemas["Schedule"];

/** Every schedule on the node (the panel filters to the server it's viewing). */
export async function getNodeSchedules(
	nodeId: string
): Promise<DaemonSchedule[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/schedules",
	})) as DaemonSchedule[];
}

export async function upsertNodeSchedule(
	nodeId: string,
	schedule: DaemonSchedule
): Promise<DaemonSchedule> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: "/api/v1/schedules",
		body: schedule,
	})) as DaemonSchedule;
}

export async function deleteNodeSchedule(
	nodeId: string,
	scheduleId: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "DELETE",
		path: `/api/v1/schedules/${scheduleId}`,
	});
}

export async function runNodeSchedule(
	nodeId: string,
	scheduleId: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `/api/v1/schedules/${scheduleId}/run`,
	});
}

// ─── backups ─────────────────────────────────────────────────────────────────

/** The daemon's view of one backup (archive = its id). */
export type DaemonBackup = Schemas["Backup"];

// A borg create on a large volume can take minutes; the create call returns
// "creating" fast, but restore runs synchronously and needs room.
const BACKUP_TIMEOUT_MS = 30 * 60 * 1000;

const backupsBase = (serverId: string) => `/api/v1/servers/${serverId}/backups`;

export async function listNodeBackups(
	nodeId: string,
	serverId: string
): Promise<DaemonBackup[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: backupsBase(serverId),
	})) as DaemonBackup[];
}

export async function createNodeBackup(
	nodeId: string,
	serverId: string,
	name: string
): Promise<DaemonBackup> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: backupsBase(serverId),
		body: { name },
	})) as DaemonBackup;
}

export async function restoreNodeBackup(
	nodeId: string,
	serverId: string,
	archive: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${backupsBase(serverId)}/restore`,
		body: { archive },
		timeoutMs: BACKUP_TIMEOUT_MS,
	});
}

export async function setNodeBackupLock(
	nodeId: string,
	serverId: string,
	archive: string,
	locked: boolean
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${backupsBase(serverId)}/${archive}/lock`,
		body: { locked },
	});
}

export async function deleteNodeBackup(
	nodeId: string,
	serverId: string,
	archive: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "DELETE",
		path: `${backupsBase(serverId)}/${archive}`,
	});
}

/** Streams `body` to the daemon as the new contents of `path` (atomic on the box). */
export async function uploadNodeFile(
	nodeId: string,
	serverId: string,
	path: string,
	body: Buffer
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const res = await daemonStream(nodeKey, ref, {
		method: "POST",
		path: withPath(`${filesBase(serverId)}/upload`, path),
		body,
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
	res.resume(); // drain the 204 body
}

/**
 * Opens a streaming download of `path`. Resolves with the live response stream
 * plus the daemon's filename + content-length headers, so the route handler can
 * pipe it to the browser without buffering the whole file in the panel.
 */
export async function openNodeDownload(
	nodeId: string,
	serverId: string,
	path: string
): Promise<{
	stream: IncomingMessage;
	filename: string;
	contentLength: string | null;
}> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	const stream = await daemonStream(nodeKey, ref, {
		method: "GET",
		path: withPath(`${filesBase(serverId)}/download`, path),
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
	const disposition = stream.headers["content-disposition"] ?? "";
	const match = /filename="([^"]*)"/.exec(
		Array.isArray(disposition) ? disposition[0] : disposition
	);
	return {
		stream,
		filename: match?.[1] || path.split("/").pop() || "download",
		contentLength: (stream.headers["content-length"] as string) ?? null,
	};
}
