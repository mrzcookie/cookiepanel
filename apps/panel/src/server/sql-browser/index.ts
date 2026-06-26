import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DaemonRead } from "@/lib/domain/nodes";
import {
	SQL_IDENTIFIER,
	sqlAdminUser,
	sqlEngine,
} from "@/lib/domain/sql-browser";
import { requireOrg } from "@/server/auth/guards";
import {
	DaemonError,
	type SqlColumn,
	type SqlDatabase,
	type SqlEngine,
	type SqlTable,
	type SqlUser,
	sqlAddColumn,
	sqlColumns,
	sqlCreateDatabase,
	sqlCreateTable,
	sqlCreateUser,
	sqlDatabases,
	sqlDropColumn,
	sqlDropDatabase,
	sqlDropTable,
	sqlDropUser,
	sqlTables,
	sqlTruncateTable,
	sqlUsers,
} from "@/server/nodes/daemon-client";
import { serversRepository } from "@/server/servers/repository";
import { unsealServerSecret } from "@/server/servers/secrets";

/**
 * SQL "Browser" add-on server functions (PostgreSQL + MySQL/MariaDB). Same posture
 * as the Redis/Mongo browsers: reads degrade to `{ ok: false }` offline, writes
 * throw, every call is org-scoped (generic not-found). The admin user is the
 * engine's default and the password is unsealed from the server's sealed root
 * password var; both pass to the daemon over the pinned channel, never returned to
 * the client. Index-only.
 */

type SqlAuth = { engine: SqlEngine; username: string; password: string };

/** Establish org scope, load the server, recover its SQL admin credentials. */
async function requireSqlConn(serverId: string): Promise<{
	nodeId: string;
	auth: SqlAuth;
}> {
	const { orgId } = await requireOrg();
	const record = await serversRepository.findById(orgId, serverId);
	if (!record) {
		throw new Error("Not found");
	}
	const engine = sqlEngine(record.eggName);
	const username = sqlAdminUser(engine);
	let password = "";
	if (engine === "postgres") {
		password = unsealServerSecret(
			orgId,
			serverId,
			"POSTGRES_PASSWORD",
			record.secretVariables
		);
	} else {
		// MySQL and MariaDB use different env-var names for the same root password.
		password =
			unsealServerSecret(
				orgId,
				serverId,
				"MYSQL_ROOT_PASSWORD",
				record.secretVariables
			) ||
			unsealServerSecret(
				orgId,
				serverId,
				"MARIADB_ROOT_PASSWORD",
				record.secretVariables
			);
	}
	return { nodeId: record.nodeId, auth: { engine, username, password } };
}

function daemonError(error: unknown): string {
	return error instanceof DaemonError
		? error.message
		: "Could not reach the database";
}

const ident = z.string().regex(SQL_IDENTIFIER).max(63);
const serverInput = z.object({ serverId: z.uuid() });
const dbInput = serverInput.extend({ db: ident });
const tableInput = dbInput.extend({ table: ident });

export const getSqlDatabases = createServerFn({ method: "GET" })
	.validator(serverInput)
	.handler(async ({ data }): Promise<DaemonRead<SqlDatabase[]>> => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		try {
			return {
				ok: true,
				data: await sqlDatabases(nodeId, data.serverId, auth),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getSqlTables = createServerFn({ method: "GET" })
	.validator(dbInput)
	.handler(async ({ data }): Promise<DaemonRead<SqlTable[]>> => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		try {
			return {
				ok: true,
				data: await sqlTables(nodeId, data.serverId, auth, data.db),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getSqlColumns = createServerFn({ method: "GET" })
	.validator(tableInput)
	.handler(async ({ data }): Promise<DaemonRead<SqlColumn[]>> => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		try {
			return {
				ok: true,
				data: await sqlColumns(
					nodeId,
					data.serverId,
					auth,
					data.db,
					data.table
				),
			};
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const getSqlUsers = createServerFn({ method: "GET" })
	.validator(serverInput)
	.handler(async ({ data }): Promise<DaemonRead<SqlUser[]>> => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		try {
			return { ok: true, data: await sqlUsers(nodeId, data.serverId, auth) };
		} catch (error) {
			return { ok: false, error: daemonError(error) };
		}
	});

export const createSqlDatabase = createServerFn({ method: "POST" })
	.validator(dbInput.extend({ charset: z.string().max(32) }))
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlCreateDatabase(nodeId, data.serverId, auth, data.db, data.charset);
		return { ok: true as const };
	});

export const dropSqlDatabase = createServerFn({ method: "POST" })
	.validator(dbInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlDropDatabase(nodeId, data.serverId, auth, data.db);
		return { ok: true as const };
	});

export const createSqlTable = createServerFn({ method: "POST" })
	.validator(tableInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlCreateTable(nodeId, data.serverId, auth, data.db, data.table);
		return { ok: true as const };
	});

export const dropSqlTable = createServerFn({ method: "POST" })
	.validator(tableInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlDropTable(nodeId, data.serverId, auth, data.db, data.table);
		return { ok: true as const };
	});

export const truncateSqlTable = createServerFn({ method: "POST" })
	.validator(tableInput)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlTruncateTable(nodeId, data.serverId, auth, data.db, data.table);
		return { ok: true as const };
	});

export const addSqlColumn = createServerFn({ method: "POST" })
	.validator(
		tableInput.extend({
			name: ident,
			type: z.string().max(64),
			nullable: z.boolean(),
			key: z.enum(["", "index", "unique"]),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlAddColumn(nodeId, data.serverId, auth, data.db, data.table, {
			name: data.name,
			type: data.type,
			nullable: data.nullable,
			key: data.key,
		});
		return { ok: true as const };
	});

export const dropSqlColumn = createServerFn({ method: "POST" })
	.validator(tableInput.extend({ column: ident }))
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlDropColumn(
			nodeId,
			data.serverId,
			auth,
			data.db,
			data.table,
			data.column
		);
		return { ok: true as const };
	});

export const createSqlUser = createServerFn({ method: "POST" })
	.validator(
		serverInput.extend({
			name: ident,
			host: z.string().max(255).default("%"),
			newPassword: z.string().max(256).default(""),
			access: z.string().max(63).default(""),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlCreateUser(nodeId, data.serverId, auth, {
			name: data.name,
			host: data.host,
			newPassword: data.newPassword,
			access: data.access,
		});
		return { ok: true as const };
	});

export const dropSqlUser = createServerFn({ method: "POST" })
	.validator(
		serverInput.extend({ name: ident, host: z.string().max(255).default("%") })
	)
	.handler(async ({ data }) => {
		const { nodeId, auth } = await requireSqlConn(data.serverId);
		await sqlDropUser(nodeId, data.serverId, auth, data.name, data.host);
		return { ok: true as const };
	});
