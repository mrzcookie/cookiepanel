import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MONGO_NAME } from "@/lib/domain/mongo-browser";
import type { DaemonRead } from "@/lib/domain/nodes";
import { requireOrg } from "@/server/auth/guards";
import {
	DaemonError,
	type MongoCollection,
	type MongoDatabase,
	type MongoDocumentPage,
	mongoCollections,
	mongoCreateCollection,
	mongoDatabases,
	mongoDelete,
	mongoDocuments,
	mongoDropCollection,
	mongoDropDatabase,
	mongoInsert,
} from "@/server/nodes/daemon-client";
import { serversRepository } from "@/server/servers/repository";
import { unsealServerSecret } from "@/server/servers/secrets";

/**
 * MongoDB "Browser" add-on server functions. Same posture as the Redis browser:
 * reads degrade to `{ ok: false }` offline, writes throw, org-scoped (generic
 * not-found). The admin user comes from the non-secret MONGO_INITDB_ROOT_USERNAME
 * var and the password from the sealed MONGO_INITDB_ROOT_PASSWORD; both pass to
 * the daemon over the pinned channel, never returned to the client. Index-only.
 */

const MONGO_USER_VAR = "MONGO_INITDB_ROOT_USERNAME";
const MONGO_PASS_VAR = "MONGO_INITDB_ROOT_PASSWORD";

/** Establish org scope, load the server, recover its Mongo admin credentials. */
async function requireMongoConn(serverId: string): Promise<{
	nodeId: string;
	auth: { username: string; password: string };
}> {
	const { orgId } = await requireOrg();
	const record = await serversRepository.findById(orgId, serverId);
	if (!record) {
		throw new Error("Not found");
	}
	const username = record.variables[MONGO_USER_VAR] ?? "root";
	const password = unsealServerSecret(
		orgId,
		serverId,
		MONGO_PASS_VAR,
		record.secretVariables
	);
	return { nodeId: record.nodeId, auth: { username, password } };
}

function daemonError(error: unknown): string {
	return error instanceof DaemonError ? error.message : "Could not reach Mongo";
}

const name = z.string().regex(MONGO_NAME).max(128);
const serverInput = z.object({ serverId: z.uuid() });
const dbInput = serverInput.extend({ db: name });
const collInput = dbInput.extend({ collection: name });

export const getMongoDatabases = createServerFn({ method: "GET" })
	.validator(serverInput)
	.handler(async ({ data }): Promise<DaemonRead<MongoDatabase[]>> => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		try {
			return {
				ok: true,
				data: await mongoDatabases(nodeId, data.serverId, auth),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getMongoCollections = createServerFn({ method: "GET" })
	.validator(dbInput)
	.handler(async ({ data }): Promise<DaemonRead<MongoCollection[]>> => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		try {
			return {
				ok: true,
				data: await mongoCollections(nodeId, data.serverId, auth, data.db),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getMongoDocuments = createServerFn({ method: "GET" })
	.validator(
		collInput.extend({
			skip: z.number().int().min(0).default(0),
			limit: z.number().int().min(1).max(100).default(25),
		})
	)
	.handler(async ({ data }): Promise<DaemonRead<MongoDocumentPage>> => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		try {
			return {
				ok: true,
				data: await mongoDocuments(
					nodeId,
					data.serverId,
					auth,
					data.db,
					data.collection,
					data.skip,
					data.limit
				),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const insertMongoDocument = createServerFn({ method: "POST" })
	.validator(collInput.extend({ doc: z.string().min(1).max(1_000_000) }))
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		await mongoInsert(
			nodeId,
			data.serverId,
			auth,
			data.db,
			data.collection,
			data.doc
		);
		return { ok: true as const };
	});

export const deleteMongoDocument = createServerFn({ method: "POST" })
	.validator(collInput.extend({ id: z.string().min(1).max(1024) }))
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		await mongoDelete(
			nodeId,
			data.serverId,
			auth,
			data.db,
			data.collection,
			data.id
		);
		return { ok: true as const };
	});

export const createMongoCollection = createServerFn({ method: "POST" })
	.validator(collInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		await mongoCreateCollection(
			nodeId,
			data.serverId,
			auth,
			data.db,
			data.collection
		);
		return { ok: true as const };
	});

export const dropMongoCollection = createServerFn({ method: "POST" })
	.validator(collInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		await mongoDropCollection(
			nodeId,
			data.serverId,
			auth,
			data.db,
			data.collection
		);
		return { ok: true as const };
	});

export const dropMongoDatabase = createServerFn({ method: "POST" })
	.validator(dbInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireMongoConn(data.serverId);
		await mongoDropDatabase(nodeId, data.serverId, auth, data.db);
		return { ok: true as const };
	});
