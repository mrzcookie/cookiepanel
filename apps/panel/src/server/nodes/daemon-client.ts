import { Readable } from "node:stream";
import type { components } from "@raptor/contract";
import { eq } from "drizzle-orm";
import type { NodeHostInfo, NodeLiveStats } from "@/lib/domain/nodes";
import { db } from "@/server/db";
import { node } from "@/server/db/schema/nodes";
import { linkHub } from "./link-hub";

// The daemon wire types are the OpenAPI contract's generated schemas — the spec
// (packages/contract/openapi.yaml) is the single source of truth, so these are
// aliases, not hand-written duplicates. Request/response shapes both come from
// `components["schemas"]`. (Conformance is now structural: tsc resolves the alias.)
type Schemas = components["schemas"];

/**
 * The typed boundary for panel → daemon calls. The box dials IN to the panel and
 * holds a WebSocket link (see link-hub); every call here tunnels over that
 * socket, keyed by node id — there is no inbound HTTPS port, cert, or pin any
 * more. The link is authenticated once at connect by the node key.
 *
 * Server-only (the DB, secret decryption, the link hub). Callers must have
 * already established the org scope — this module addresses a node by id and does
 * not re-check tenancy.
 */

const REQUEST_TIMEOUT_MS = 10_000;

// Max single file transfer over the link (raw bytes). Stays under the daemon's
// 96 MiB WS frame cap after base64. Larger files need the chunked path (TODO).
const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

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

/**
 * The reason out of a daemon error response. The daemon reports failures as
 * `{"error":"<reason>"}` (its `writeJSONError`), so pull that out and append it to
 * the error message — otherwise a rejected create/start surfaces to the panel (and
 * the user's "Setup failed") as a bare `HTTP 400` with no *why*. Falls back to a
 * trimmed snippet for a non-JSON body.
 */
function daemonErrorDetail(raw: string): string {
	const text = raw.trim();
	if (!text) {
		return "";
	}
	try {
		const parsed = JSON.parse(text) as { error?: unknown };
		if (typeof parsed.error === "string" && parsed.error) {
			return ` — ${parsed.error}`;
		}
	} catch {
		// Not JSON — fall through to the raw snippet.
	}
	return ` — ${text.slice(0, 200)}`;
}

type NodeRef = {
	id: string;
};

/**
 * Resolves a node id to its dial args. The link routes control by node id (the
 * node key already authenticated the socket at connect), so the id is all the
 * transport needs — we no longer join the credential or unseal the (root-
 * equivalent) node key on every call. `nodeKey` stays in the return shape only so
 * the ~70 wrappers' `{ node, nodeKey }` destructure is unchanged; it's empty and
 * unused. A node with no live link fails later in the hub with a clear error.
 */
async function loadDialer(
	nodeId: string
): Promise<{ node: NodeRef; nodeKey: string }> {
	const [row] = await db
		.select({ id: node.id })
		.from(node)
		.where(eq(node.id, nodeId))
		.limit(1);

	if (!row) {
		throw new DaemonError(`node ${nodeId} not found`);
	}

	return { node: { id: row.id }, nodeKey: "" };
}

type DaemonFetchOptions = {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	body?: unknown;
	timeoutMs?: number;
};

/**
 * One JSON request to the daemon, tunnelled over the node's live WebSocket link
 * (the box dials in — see link-hub; there is no inbound HTTPS port any more).
 * Throws `DaemonError` (with status + body) on non-2xx; returns parsed JSON (or
 * raw text). `_nodeKey` is unused here (the socket is already authenticated) but
 * kept in the signature so the ~70 wrappers stay byte-for-byte unchanged.
 */
function daemonFetch(
	_nodeKey: string,
	ref: NodeRef,
	opts: DaemonFetchOptions
): Promise<unknown> {
	return hubFetch(ref.id, opts);
}

/** Tunnel a JSON request over the node's live WebSocket link. */
async function hubFetch(
	nodeId: string,
	opts: DaemonFetchOptions
): Promise<unknown> {
	const method = opts.method ?? "GET";
	const resp = await linkHub.request(
		nodeId,
		{
			method,
			path: opts.path,
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		},
		opts.timeoutMs ?? REQUEST_TIMEOUT_MS
	);
	if (resp.status < 200 || resp.status >= 300) {
		throw new DaemonError(
			`daemon ${method} ${opts.path}: HTTP ${resp.status}${daemonErrorDetail(resp.body)}`,
			resp.status,
			resp.body.slice(0, 500)
		);
	}
	if (!resp.body) {
		return resp.body;
	}
	try {
		return JSON.parse(resp.body);
	} catch {
		return resp.body;
	}
}

type DaemonBinaryOptions = {
	method: "GET" | "POST";
	path: string;
	body?: Buffer;
	timeoutMs?: number;
};

/**
 * A binary request (file upload/download) tunnelled over the link. The body is
 * base64-encoded on the way out and decoded on the way back, so binary content
 * round-trips intact. Buffers the whole body — fine for the file manager; a
 * chunked path for very large transfers is a later optimization. Throws
 * `DaemonError` on a non-2xx response.
 */
async function hubBinary(
	nodeId: string,
	opts: DaemonBinaryOptions
): Promise<{ bytes: Buffer; headers: Record<string, string> }> {
	// Cap uploads so a single file can't produce a frame past the daemon's WS read
	// limit (which would drop the whole node link). base64 inflates ~1.33×, so
	// 64 MiB raw stays under the daemon's 96 MiB frame cap.
	if (opts.body && opts.body.byteLength > MAX_TRANSFER_BYTES) {
		throw new DaemonError(
			`file too large: ${opts.body.byteLength} bytes exceeds the ${MAX_TRANSFER_BYTES}-byte transfer limit`,
			413
		);
	}
	const resp = await linkHub.request(
		nodeId,
		{
			method: opts.method,
			path: opts.path,
			body: opts.body ? opts.body.toString("base64") : undefined,
			encoding: opts.body ? "base64" : undefined,
		},
		opts.timeoutMs ?? REQUEST_TIMEOUT_MS
	);
	if (resp.status < 200 || resp.status >= 300) {
		throw new DaemonError(
			`daemon ${opts.method} ${opts.path}: HTTP ${resp.status}${daemonErrorDetail(resp.body)}`,
			resp.status,
			resp.body.slice(0, 500)
		);
	}
	const bytes =
		resp.encoding === "base64"
			? Buffer.from(resp.body, "base64")
			: Buffer.from(resp.body, "utf8");
	return { bytes, headers: resp.headers ?? {} };
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

/** POST /api/v1/system/restart-daemon — restart the wings agent (via systemd). */
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
	nodeId: string,
	// The org-wide list fan-out passes a tighter budget so one slow box can't
	// stall the whole page; single-node reads keep the default.
	timeoutMs?: number
): Promise<DaemonNetwork[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		path: "/api/v1/networks",
		timeoutMs,
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
		path: `${filesBase(serverId)}/url-download/${encodeURIComponent(jobId)}`,
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
		path: `${backupsBase(serverId)}/${encodeURIComponent(archive)}/lock`,
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
		path: `${backupsBase(serverId)}/${encodeURIComponent(archive)}`,
	});
}

// ─── redis browser ─────────────────────────────────────────────────────────
// Every call carries the admin password + logical db in the body (over the pinned
// channel); the daemon resolves the container's published 6379 itself. Types are
// the generated contract schemas.

export type RedisOverview = Schemas["RedisOverview"];
export type RedisKeyList = Schemas["RedisKeyList"];
export type RedisKeyDetail = Schemas["RedisKeyDetail"];
export type RedisSetRequest = Schemas["RedisSetRequest"];

const redisBase = (serverId: string) => `/api/v1/servers/${serverId}/redis`;

type RedisAuth = { password: string; db: number };

export async function redisOverview(
	nodeId: string,
	serverId: string,
	auth: RedisAuth
): Promise<RedisOverview> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/overview`,
		body: auth,
	})) as RedisOverview;
}

export async function redisKeys(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	pattern: string,
	cursor: string,
	count: number
): Promise<RedisKeyList> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/keys`,
		body: { ...auth, pattern, cursor, count },
	})) as RedisKeyList;
}

export async function redisKey(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	key: string
): Promise<RedisKeyDetail> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/key`,
		body: { ...auth, key },
	})) as RedisKeyDetail;
}

export async function redisSet(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	set: RedisSetRequest
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/set`,
		body: { ...auth, set },
	});
}

export async function redisDelete(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	key: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/delete`,
		body: { ...auth, key },
	});
}

export async function redisRename(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	key: string,
	newKey: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/rename`,
		body: { ...auth, key, newKey },
	});
}

export async function redisTtl(
	nodeId: string,
	serverId: string,
	auth: RedisAuth,
	key: string,
	ttlSeconds: number
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/ttl`,
		body: { ...auth, key, ttlSeconds },
	});
}

export async function redisFlush(
	nodeId: string,
	serverId: string,
	auth: RedisAuth
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${redisBase(serverId)}/flush`,
		body: auth,
	});
}

// ─── mongo browser ─────────────────────────────────────────────────────────
// The panel passes the admin user + password in the body; the daemon resolves the
// container's published 27017 itself. Types are the generated contract schemas.

export type MongoDatabase = Schemas["MongoDatabase"];
export type MongoCollection = Schemas["MongoCollection"];
export type MongoDocumentPage = Schemas["MongoDocumentPage"];

const mongoBase = (serverId: string) => `/api/v1/servers/${serverId}/mongo`;

type MongoAuth = { username: string; password: string };

export async function mongoDatabases(
	nodeId: string,
	serverId: string,
	auth: MongoAuth
): Promise<MongoDatabase[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/databases`,
		body: auth,
	})) as MongoDatabase[];
}

export async function mongoCollections(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string
): Promise<MongoCollection[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/collections`,
		body: { ...auth, db },
	})) as MongoCollection[];
}

export async function mongoDocuments(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string,
	collection: string,
	skip: number,
	limit: number
): Promise<MongoDocumentPage> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/documents`,
		body: { ...auth, db, collection, skip, limit },
	})) as MongoDocumentPage;
}

export async function mongoInsert(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string,
	collection: string,
	doc: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/insert`,
		body: { ...auth, db, collection, doc },
	});
}

export async function mongoDelete(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string,
	collection: string,
	id: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/delete`,
		body: { ...auth, db, collection, id },
	});
}

export async function mongoCreateCollection(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string,
	collection: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/create-collection`,
		body: { ...auth, db, collection },
	});
}

export async function mongoDropCollection(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string,
	collection: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/drop-collection`,
		body: { ...auth, db, collection },
	});
}

export async function mongoDropDatabase(
	nodeId: string,
	serverId: string,
	auth: MongoAuth,
	db: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${mongoBase(serverId)}/drop-database`,
		body: { ...auth, db },
	});
}

// ─── sql browser ───────────────────────────────────────────────────────────
// The panel passes the engine discriminator + admin user + password in the body;
// the daemon maps the engine to its container port and resolves the published one
// itself. Types are the generated contract schemas.

export type SqlDatabase = Schemas["SqlDatabase"];
export type SqlTable = Schemas["SqlTable"];
export type SqlColumn = Schemas["SqlColumn"];
export type SqlUser = Schemas["SqlUser"];
export type SqlEngine = "postgres" | "mysql";

const sqlBase = (serverId: string) => `/api/v1/servers/${serverId}/sql`;

type SqlAuth = { engine: SqlEngine; username: string; password: string };

export async function sqlDatabases(
	nodeId: string,
	serverId: string,
	auth: SqlAuth
): Promise<SqlDatabase[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/databases`,
		body: auth,
	})) as SqlDatabase[];
}

export async function sqlCreateDatabase(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	charset: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/create-database`,
		body: { ...auth, db, charset },
	});
}

export async function sqlDropDatabase(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/drop-database`,
		body: { ...auth, db },
	});
}

export async function sqlTables(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string
): Promise<SqlTable[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/tables`,
		body: { ...auth, db },
	})) as SqlTable[];
}

export async function sqlCreateTable(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/create-table`,
		body: { ...auth, db, table },
	});
}

export async function sqlDropTable(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/drop-table`,
		body: { ...auth, db, table },
	});
}

export async function sqlTruncateTable(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/truncate-table`,
		body: { ...auth, db, table },
	});
}

export async function sqlColumns(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string
): Promise<SqlColumn[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/columns`,
		body: { ...auth, db, table },
	})) as SqlColumn[];
}

export async function sqlAddColumn(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string,
	col: { name: string; type: string; nullable: boolean; key: string }
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/add-column`,
		body: { ...auth, db, table, ...col },
	});
}

export async function sqlDropColumn(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	db: string,
	table: string,
	column: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/drop-column`,
		body: { ...auth, db, table, column },
	});
}

export async function sqlUsers(
	nodeId: string,
	serverId: string,
	auth: SqlAuth
): Promise<SqlUser[]> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	return (await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/users`,
		body: auth,
	})) as SqlUser[];
}

export async function sqlCreateUser(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	spec: { name: string; host: string; newPassword: string; access: string }
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/create-user`,
		body: { ...auth, ...spec },
	});
}

export async function sqlDropUser(
	nodeId: string,
	serverId: string,
	auth: SqlAuth,
	name: string,
	host: string
): Promise<void> {
	const { node: ref, nodeKey } = await loadDialer(nodeId);
	await daemonFetch(nodeKey, ref, {
		method: "POST",
		path: `${sqlBase(serverId)}/drop-user`,
		body: { ...auth, name, host },
	});
}

/** Streams `body` to the daemon as the new contents of `path` (atomic on the box). */
export async function uploadNodeFile(
	nodeId: string,
	serverId: string,
	path: string,
	body: Buffer
): Promise<void> {
	const { node: ref } = await loadDialer(nodeId);
	await hubBinary(ref.id, {
		method: "POST",
		path: withPath(`${filesBase(serverId)}/upload`, path),
		body,
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
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
	stream: Readable;
	filename: string;
	contentLength: string | null;
}> {
	const { node: ref } = await loadDialer(nodeId);
	const { bytes, headers } = await hubBinary(ref.id, {
		method: "GET",
		path: withPath(`${filesBase(serverId)}/download`, path),
		timeoutMs: FILE_DOWNLOAD_TIMEOUT_MS,
	});
	const disposition = headers["content-disposition"] ?? "";
	const match = /filename="([^"]*)"/.exec(disposition);
	return {
		stream: Readable.from(bytes),
		filename: match?.[1] || path.split("/").pop() || "download",
		contentLength: headers["content-length"] ?? String(bytes.byteLength),
	};
}
