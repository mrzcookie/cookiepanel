import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { EggConfigFile } from "@/lib/domain/eggs";
import type { ServerRow, ServerState } from "@/lib/domain/servers";
import { formatRelativeTime } from "@/lib/format";
import { recordActivity } from "@/server/activity/record";
import {
	releaseServerFirewall,
	reserveAllocation,
} from "@/server/allocations/service";
import { requireOrg } from "@/server/auth/guards";
import { seal } from "@/server/crypto";
import {
	type EggImageRecord,
	type EggRecord,
	type EggVariableRecord,
	eggsRepository,
} from "@/server/eggs/repository";
import {
	controlServerOnNode,
	createServerOnNode,
	type DaemonServerSpec,
	deleteServerOnNode,
	getServerOnNode,
	sendCommandOnNode,
} from "@/server/nodes/daemon-client";
import { type NodeRecord, nodesRepository } from "@/server/nodes/repository";
import { serverSecretAad } from "@/server/servers/secrets";
import {
	type ServerListRecord,
	type ServerRecord,
	serversRepository,
} from "./repository";

/**
 * Servers service + server functions. A server is a Docker container the daemon
 * runs; this layer owns the *desired* state (the registry row) and drives the
 * daemon over the pinned channel in lockstep. Reads return the registry row
 * (fast); `syncServer` reconciles the live container state on demand.
 *
 * Secret variable values are sealed at rest (AES-GCM, AAD bound to org+server+
 * env-var) and never returned to the client. Image strings stay server-only.
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

// The secret-var AAD lives in ./secrets (shared with the Redis browser, which
// recovers REDIS_PASSWORD the same way). Aliased so the existing call sites below
// read unchanged.
const secretAad = serverSecretAad;

// Map the daemon's reported state onto the domain vocabulary. Most values are
// Docker's raw container states; `installing` / `failed` are reported by the
// daemon's install tracker while a server has no container yet.
function mapDaemonState(raw: string): ServerState {
	switch (raw) {
		case "running":
			return "running";
		case "restarting":
			return "starting";
		case "installing":
			return "installing";
		case "failed":
			return "failed";
		default:
			// created / exited / dead / paused / removing → not running.
			return "stopped";
	}
}

function nodeAddress(node: { fqdn: string }): string {
	return node.fqdn;
}

// Accepts the list projection; a full `ServerRecord` is assignable to it, so the
// single-server paths (sync / rename / power / …) still pass their full rows.
function toServerRow(record: ServerListRecord, node: NodeRecord): ServerRow {
	return {
		id: record.id,
		name: record.name,
		eggName: record.eggName,
		eggId: record.eggId,
		imageLabel: record.imageLabel,
		updateAvailable: false,
		state: record.state as ServerState,
		nodeId: record.nodeId,
		nodeName: node.name,
		nodeAddress: nodeAddress(node),
		port: record.port,
		// Live readouts arrive on the stats/console channel in a later slice.
		cpuPercent: null,
		memUsedBytes: null,
		cpuLimitCores: record.cpuLimitMillicores / 1000,
		memLimitBytes: record.memLimitBytes,
		diskUsedBytes: null,
		diskLimitBytes: record.diskLimitBytes,
		uptimeSeconds: null,
		createdAt: formatRelativeTime(record.createdAt),
		variables: record.variables,
		lastError: record.lastError,
	};
}

type EggSnapshot = {
	egg: EggRecord;
	images: EggImageRecord[];
	variables: EggVariableRecord[];
};

/** Load an egg the org can deploy (its own, or a published official one). */
async function loadEgg(orgId: string, eggId: string): Promise<EggSnapshot> {
	const egg = await eggsRepository.findVisible({ kind: "org", orgId }, eggId);
	if (!egg) {
		throw new Error("Egg not found");
	}
	const [images, variables] = await Promise.all([
		eggsRepository.imagesFor([eggId]),
		eggsRepository.variablesFor([eggId]),
	]);
	return { egg, images, variables };
}

/** Resolve a runtime label to its server-only image string (default / first). */
function resolveImage(
	images: EggImageRecord[],
	label: string | undefined
): { image: string; label: string } {
	const chosen =
		(label && images.find((i) => i.label === label)) ||
		images.find((i) => i.isDefault) ||
		images.at(0);
	if (!chosen) {
		throw new Error("Egg has no runtime image");
	}
	return { image: chosen.image, label: chosen.label };
}

/**
 * Split the player-set values across the egg's variable schema: build the
 * full env to dispatch, the non-secret snapshot to store, and the sealed secret
 * values. Hidden/read-only vars fall back to their defaults.
 */
function buildVariables(
	orgId: string,
	serverId: string,
	eggVars: EggVariableRecord[],
	provided: Record<string, string>
) {
	const env: Record<string, string> = {};
	const variables: Record<string, string> = {};
	const secretVariables: Record<string, string> = {};
	for (const v of eggVars) {
		const value = provided[v.envVariable] ?? v.defaultValue ?? "";
		env[v.envVariable] = value;
		if (v.access === "secret") {
			if (value !== "") {
				secretVariables[v.envVariable] = seal(
					value,
					secretAad(orgId, serverId, v.envVariable)
				);
			}
		} else {
			variables[v.envVariable] = value;
		}
	}
	return { env, variables, secretVariables };
}

/** Substitute `{{VAR}}` tokens in `text` with resolved env values (startup
 * command + config-file replacements share this). */
function resolveTokens(text: string, env: Record<string, string>): string {
	let out = text;
	for (const [key, value] of Object.entries(env)) {
		out = out.replaceAll(`{{${key}}}`, value);
	}
	return out;
}

/** Resolve `{{token}}` values in the egg's config files for the daemon. */
function resolveConfigFiles(
	files: EggConfigFile[],
	env: Record<string, string>
): DaemonServerSpec["configFiles"] {
	if (files.length === 0) {
		return undefined;
	}
	return files.map((cf) => ({
		file: cf.file,
		parser: cf.parser,
		replace: Object.fromEntries(
			Object.entries(cf.replace).map(([key, value]) => [
				key,
				resolveTokens(value, env),
			])
		),
	}));
}

/** The egg install step for an egg, or undefined when it has no script. */
function installSpec(
	egg: EggRecord,
	runtimeImage: string,
	env: Record<string, string>
): DaemonServerSpec["install"] {
	if (egg.installScript.trim() === "") {
		return undefined;
	}
	return {
		// An egg with a script but no install image is misconfigured; fall back
		// to the runtime image (the daemon does the same, but be explicit).
		image: egg.installContainerImage || runtimeImage,
		entrypoint: egg.installEntrypoint,
		script: egg.installScript,
		env,
	};
}

function daemonSpec(
	record: ServerRecord,
	env: Record<string, string>,
	install?: DaemonServerSpec["install"],
	configFiles: EggConfigFile[] = []
): DaemonServerSpec {
	// Token resolution sees the egg vars plus the daemon's standard SERVER_*
	// values (so `{{SERVER_PORT}}` in a startup command or config file resolves).
	const resolveEnv: Record<string, string> = {
		...env,
		SERVER_PORT: record.port !== null ? String(record.port) : "",
		SERVER_IP: "0.0.0.0",
		SERVER_MEMORY: String(Math.round(record.memLimitBytes / (1024 * 1024))),
	};
	const spec: DaemonServerSpec = {
		// The container name is the (regex-safe) server id; the daemon keys off the
		// server-id label, so this is just a unique, valid container name.
		serverId: record.id,
		name: record.id,
		image: record.image,
		startupCommand: resolveTokens(record.startupCommand, resolveEnv),
		env,
		nanoCpus: record.cpuLimitMillicores * 1_000_000,
		memoryMb: Math.round(record.memLimitBytes / (1024 * 1024)),
		diskMb: Math.round(record.diskLimitBytes / (1024 * 1024)),
		stopSignal: record.stopSignal ?? undefined,
		install,
		configFiles: resolveConfigFiles(configFiles, resolveEnv),
	};
	if (record.port !== null) {
		spec.portBinding = {
			hostIp: "0.0.0.0",
			hostPort: record.port,
			containerPort: record.port,
			protocol: "tcp",
		};
	}
	return spec;
}

// ─── guards / input ──────────────────────────────────────────────────────────

const idInput = z.object({ id: z.uuid() });

/** Load a server scoped to the org + its node, or throw a generic not-found. */
async function requireServer(orgId: string, id: string) {
	const record = await serversRepository.findById(orgId, id);
	if (!record) {
		throw new Error("Not found");
	}
	const node = await nodesRepository.findById(orgId, record.nodeId);
	if (!node) {
		throw new Error("Not found");
	}
	return { record, node };
}

// ─── reads ───────────────────────────────────────────────────────────────────

export const listServers = createServerFn({ method: "GET" }).handler(
	async () => {
		const { orgId } = await requireOrg();
		const [rows, nodes] = await Promise.all([
			serversRepository.listView(orgId),
			nodesRepository.list(orgId),
		]);
		const byId = new Map(nodes.map((n) => [n.id, n]));
		return rows
			.map((row) => {
				const node = byId.get(row.nodeId);
				return node ? toServerRow(row, node) : null;
			})
			.filter((row): row is ServerRow => row !== null);
	}
);

export const listServersForNode = createServerFn({ method: "GET" })
	.validator(z.object({ nodeId: z.uuid() }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const node = await nodesRepository.findById(orgId, data.nodeId);
		if (!node) {
			return [];
		}
		const rows = await serversRepository.listByNodeView(orgId, data.nodeId);
		return rows.map((row) => toServerRow(row, node));
	});

/** Reconcile one server's live state with its node's daemon, then return it. */
export const syncServer = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { record, node } = await requireServer(orgId, data.id);
		try {
			const live = await getServerOnNode(record.nodeId, record.id);
			const state = mapDaemonState(live.state);
			// Carry the daemon's failure detail (e.g. a failed install) into
			// lastError; clear it once the server is no longer failed.
			const lastError =
				state === "failed"
					? (live.error ?? record.lastError ?? "Install failed")
					: null;
			if (state !== record.state || lastError !== record.lastError) {
				const updated = await serversRepository.update(orgId, record.id, {
					state,
					lastError,
				});
				return toServerRow(updated ?? record, node);
			}
		} catch {
			// Box unreachable / no container — keep the last-observed state.
		}
		return toServerRow(record, node);
	});

// ─── create ──────────────────────────────────────────────────────────────────

const createInput = z.object({
	nodeId: z.uuid(),
	eggId: z.uuid(),
	name: z.string().trim().min(1).max(100),
	runtimeLabel: z.string().optional(),
	port: z.number().int().min(1).max(65535),
	cpuLimitCores: z.number().positive(),
	memLimitBytes: z.number().int().positive(),
	diskLimitBytes: z.number().int().positive(),
	variables: z.record(z.string(), z.string()).default({}),
});

export const createServer = createServerFn({ method: "POST" })
	.validator(createInput)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();
		const node = await nodesRepository.findById(orgId, data.nodeId);
		if (!node) {
			throw new Error("Not found");
		}
		const {
			egg,
			images,
			variables: eggVars,
		} = await loadEgg(orgId, data.eggId);

		const serverId = randomUUID();
		const { image, label } = resolveImage(images, data.runtimeLabel);
		const { env, variables, secretVariables } = buildVariables(
			orgId,
			serverId,
			eggVars,
			data.variables
		);

		// Land the registry row first (installing), so a failed daemon dispatch
		// still leaves a visible, deletable server carrying the error.
		let record = await serversRepository.create(orgId, {
			id: serverId,
			nodeId: data.nodeId,
			name: data.name.trim(),
			eggId: egg.id,
			eggName: egg.name,
			eggVersion: egg.version,
			imageLabel: label,
			image,
			startupCommand: egg.startupCommand,
			// A "signal" stop maps straight to docker's StopSignal; "command"
			// (send a console command, then stop) and "native" keep the default —
			// the command-based graceful stop is the console/stop slice's job.
			stopSignal:
				egg.stopType === "signal" && egg.stopValue ? egg.stopValue : null,
			state: "installing",
			port: data.port,
			cpuLimitMillicores: Math.round(data.cpuLimitCores * 1000),
			memLimitBytes: data.memLimitBytes,
			diskLimitBytes: data.diskLimitBytes,
			variables,
			secretVariables,
			lastError: null,
		});

		// Claim the port allocation FIRST (it opens the firewall too). Reserving
		// before the daemon create closes the race where two concurrent deploys
		// both pass the wizard's free-port pre-check and then bind the same slot:
		// the loser's reserve hits the unique constraint and we fail fast without
		// dispatching a doomed create. The allocation stays attached to the server
		// (even a failed one) and cascades away when it's deleted.
		let portReserved = false;
		try {
			await reserveAllocation(orgId, data.nodeId, serverId, data.port, "tcp");
			portReserved = true;
		} catch {
			record =
				(await serversRepository.update(orgId, serverId, {
					state: "failed",
					lastError: `Port ${data.port} is already in use on this node.`,
				})) ?? record;
		}

		if (portReserved) {
			const install = installSpec(egg, image, env);
			try {
				const live = await createServerOnNode(
					data.nodeId,
					daemonSpec(record, env, install, egg.configFiles)
				);
				record =
					(await serversRepository.update(orgId, serverId, {
						state: mapDaemonState(live.state),
						lastError: live.error ?? null,
					})) ?? record;
			} catch (error) {
				record =
					(await serversRepository.update(orgId, serverId, {
						state: "failed",
						lastError: error instanceof Error ? error.message : "Deploy failed",
					})) ?? record;
			}
		}

		await recordActivity({
			category: "server",
			action: "server.created",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "server",
			targetId: serverId,
			targetLabel: record.name,
		});

		return toServerRow(record, node);
	});

// ─── power ───────────────────────────────────────────────────────────────────

// Shared power-control body. A plain server-only helper (not a `createServerFn`
// factory) so the three exports below stay statically-analyzable `createServerFn`
// declarations — a factory that returns a server fn defeats the compiler's handler
// split and leaks server-only imports (guards/db) into the client bundle.
async function powerServer(
	action: "start" | "stop" | "restart",
	id: string
): Promise<ServerRow> {
	const { orgId } = await requireOrg();
	const { record, node } = await requireServer(orgId, id);
	const live = await controlServerOnNode(record.nodeId, record.id, action);
	const updated = await serversRepository.update(orgId, record.id, {
		state: mapDaemonState(live.state),
		lastError: null,
	});
	return toServerRow(updated ?? record, node);
}

export const startServer = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(({ data }) => powerServer("start", data.id));

export const stopServer = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(({ data }) => powerServer("stop", data.id));

export const restartServer = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(({ data }) => powerServer("restart", data.id));

// ─── delete ──────────────────────────────────────────────────────────────────

export const removeServer = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();
		const { record } = await requireServer(orgId, data.id);
		// Close the firewall for the server's port allocations before they cascade
		// away with the row below.
		await releaseServerFirewall(orgId, record.id);
		// Best-effort container teardown; the registry row goes regardless so a
		// dead box can't strand a server in the panel.
		try {
			await deleteServerOnNode(record.nodeId, record.id);
		} catch {
			// container already gone / box unreachable
		}
		await serversRepository.remove(orgId, record.id);
		await recordActivity({
			category: "server",
			action: "server.deleted",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "server",
			targetId: record.id,
			targetLabel: record.name,
		});
		return { id: record.id };
	});

// ─── registry edits (snapshot/desired-state; applied to the box on next deploy) ─

export const renameServer = createServerFn({ method: "POST" })
	.validator(
		z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100) })
	)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { node } = await requireServer(orgId, data.id);
		const updated = await serversRepository.update(orgId, data.id, {
			name: data.name.trim(),
		});
		if (!updated) {
			throw new Error("Not found");
		}
		return toServerRow(updated, node);
	});

export const updateServerLimits = createServerFn({ method: "POST" })
	.validator(
		z.object({
			id: z.uuid(),
			cpuLimitCores: z.number().positive(),
			memLimitBytes: z.number().int().positive(),
			diskLimitBytes: z.number().int().positive(),
		})
	)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { node } = await requireServer(orgId, data.id);
		const updated = await serversRepository.update(orgId, data.id, {
			cpuLimitMillicores: Math.round(data.cpuLimitCores * 1000),
			memLimitBytes: data.memLimitBytes,
			diskLimitBytes: data.diskLimitBytes,
		});
		if (!updated) {
			throw new Error("Not found");
		}
		return toServerRow(updated, node);
	});

export const updateServerVariables = createServerFn({ method: "POST" })
	.validator(
		z.object({ id: z.uuid(), variables: z.record(z.string(), z.string()) })
	)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { record, node } = await requireServer(orgId, data.id);
		const eggVars = await eggsRepository.variablesFor([record.eggId]);
		const secretEnv = new Set(
			eggVars.filter((v) => v.access === "secret").map((v) => v.envVariable)
		);
		// Only touch what this request provides: re-seal secrets explicitly given (an
		// empty value means "keep current"), and merge non-secret values over the
		// stored snapshot. Untouched secrets keep their existing ciphertext — they're
		// never reset to an egg default.
		const variables = { ...record.variables };
		const secretVariables = { ...record.secretVariables };
		for (const [key, value] of Object.entries(data.variables)) {
			if (secretEnv.has(key)) {
				if (value !== "") {
					secretVariables[key] = seal(value, secretAad(orgId, record.id, key));
				}
			} else {
				variables[key] = value;
			}
		}
		const updated = await serversRepository.update(orgId, data.id, {
			variables,
			secretVariables,
		});
		if (!updated) {
			throw new Error("Not found");
		}
		return toServerRow(updated, node);
	});

export const updateServerRuntime = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.uuid(), imageLabel: z.string().min(1) }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { record, node } = await requireServer(orgId, data.id);
		const images = await eggsRepository.imagesFor([record.eggId]);
		const { image, label } = resolveImage(images, data.imageLabel);
		const updated = await serversRepository.update(orgId, data.id, {
			image,
			imageLabel: label,
		});
		if (!updated) {
			throw new Error("Not found");
		}
		return toServerRow(updated, node);
	});

// ─── console ─────────────────────────────────────────────────────────────────

/** Send a console command to the server's container. */
export const sendServerCommand = createServerFn({ method: "POST" })
	.validator(z.object({ id: z.uuid(), command: z.string().min(1).max(2000) }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { record } = await requireServer(orgId, data.id);
		await sendCommandOnNode(record.nodeId, record.id, data.command.trim());
		return { ok: true as const };
	});
