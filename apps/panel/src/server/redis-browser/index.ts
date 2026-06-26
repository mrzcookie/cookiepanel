import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DaemonRead } from "@/lib/domain/nodes";
import { requireOrg } from "@/server/auth/guards";
import {
	DaemonError,
	type RedisKeyDetail,
	type RedisKeyList,
	type RedisOverview,
	type RedisSetRequest,
	redisDelete,
	redisFlush,
	redisKey,
	redisKeys,
	redisOverview,
	redisRename,
	redisSet,
	redisTtl,
} from "@/server/nodes/daemon-client";
import { serversRepository } from "@/server/servers/repository";
import { unsealServerSecret } from "@/server/servers/secrets";

/**
 * Redis "Browser" add-on server functions. The Redis instance is daemon-derived,
 * so reads dial the box on demand and degrade to `{ ok: false }` offline; writes
 * throw so the UI can toast. Org-scoped (generic not-found). The admin password is
 * recovered from the server's sealed `REDIS_PASSWORD` var and passed to the daemon
 * over the pinned channel — never returned to the client. Index-only.
 */

// The redis egg's admin-password variable (sets requirepass).
const REDIS_PASSWORD_VAR = "REDIS_PASSWORD";

/** Establish org scope, load the server, recover its Redis admin password. */
async function requireRedisConn(
	serverId: string
): Promise<{ nodeId: string; password: string }> {
	const { orgId } = await requireOrg();
	const record = await serversRepository.findById(orgId, serverId);
	if (!record) {
		throw new Error("Not found");
	}
	const password = unsealServerSecret(
		orgId,
		serverId,
		REDIS_PASSWORD_VAR,
		record.secretVariables
	);
	return { nodeId: record.nodeId, password };
}

function daemonError(error: unknown): string {
	return error instanceof DaemonError ? error.message : "Could not reach Redis";
}

const dbInput = z.object({
	serverId: z.uuid(),
	db: z.number().int().min(0).max(15),
});
const keyInput = dbInput.extend({ key: z.string().min(1).max(1024) });

const setInput = dbInput.extend({
	set: z.object({
		key: z.string().min(1).max(1024),
		type: z.enum(["string", "hash", "list", "set", "zset"]),
		ttlSeconds: z.number().int(),
		string: z.string().optional(),
		fields: z
			.array(z.object({ field: z.string(), value: z.string() }))
			.optional(),
		items: z.array(z.string()).optional(),
		members: z
			.array(z.object({ member: z.string(), score: z.number() }))
			.optional(),
	}),
});

export const getRedisOverview = createServerFn({ method: "GET" })
	.validator(dbInput)
	.handler(async ({ data }): Promise<DaemonRead<RedisOverview>> => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		try {
			return {
				ok: true,
				data: await redisOverview(nodeId, data.serverId, {
					password,
					db: data.db,
				}),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getRedisKeys = createServerFn({ method: "GET" })
	.validator(
		dbInput.extend({
			pattern: z.string().max(256).default("*"),
			cursor: z.string().max(64).default("0"),
			count: z.number().int().min(1).max(500).default(100),
		})
	)
	.handler(async ({ data }): Promise<DaemonRead<RedisKeyList>> => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		try {
			return {
				ok: true,
				data: await redisKeys(
					nodeId,
					data.serverId,
					{ password, db: data.db },
					data.pattern,
					data.cursor,
					data.count
				),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getRedisKey = createServerFn({ method: "GET" })
	.validator(keyInput)
	.handler(async ({ data }): Promise<DaemonRead<RedisKeyDetail>> => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		try {
			return {
				ok: true,
				data: await redisKey(
					nodeId,
					data.serverId,
					{ password, db: data.db },
					data.key
				),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const setRedisKey = createServerFn({ method: "POST" })
	.validator(setInput)
	.handler(async ({ data }) => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		await redisSet(
			nodeId,
			data.serverId,
			{ password, db: data.db },
			data.set as RedisSetRequest
		);
		return { ok: true as const };
	});

export const deleteRedisKey = createServerFn({ method: "POST" })
	.validator(keyInput)
	.handler(async ({ data }) => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		await redisDelete(
			nodeId,
			data.serverId,
			{ password, db: data.db },
			data.key
		);
		return { ok: true as const };
	});

export const renameRedisKey = createServerFn({ method: "POST" })
	.validator(keyInput.extend({ newKey: z.string().min(1).max(1024) }))
	.handler(async ({ data }) => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		await redisRename(
			nodeId,
			data.serverId,
			{ password, db: data.db },
			data.key,
			data.newKey
		);
		return { ok: true as const };
	});

export const setRedisTtl = createServerFn({ method: "POST" })
	.validator(keyInput.extend({ ttlSeconds: z.number().int() }))
	.handler(async ({ data }) => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		await redisTtl(
			nodeId,
			data.serverId,
			{ password, db: data.db },
			data.key,
			data.ttlSeconds
		);
		return { ok: true as const };
	});

export const flushRedisDb = createServerFn({ method: "POST" })
	.validator(dbInput)
	.handler(async ({ data }) => {
		const { nodeId, password } = await requireRedisConn(data.serverId);
		await redisFlush(nodeId, data.serverId, { password, db: data.db });
		return { ok: true as const };
	});
