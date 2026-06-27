import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { server } from "@/server/db/schema/servers";

export type ServerRecord = typeof server.$inferSelect;

/**
 * The columns the org-wide list views actually render (see `toServerRow`). It
 * deliberately omits the sealed `secretVariables` (an AES-GCM jsonb blob), the
 * server-only `image`/`startupCommand`/`stopSignal`, and `eggVersion` — so the
 * fleet list and its 15s poll never fetch or deserialize them for every server.
 * A full `ServerRecord` is assignable to this (it's a subset), so the create /
 * sync / single-server paths keep passing full rows to `toServerRow` unchanged.
 */
export type ServerListRecord = Pick<
	ServerRecord,
	| "id"
	| "name"
	| "eggName"
	| "eggId"
	| "imageLabel"
	| "state"
	| "nodeId"
	| "port"
	| "cpuLimitMillicores"
	| "memLimitBytes"
	| "diskLimitBytes"
	| "variables"
	| "lastError"
	| "createdAt"
>;

const listColumns = {
	id: server.id,
	name: server.name,
	eggName: server.eggName,
	eggId: server.eggId,
	imageLabel: server.imageLabel,
	state: server.state,
	nodeId: server.nodeId,
	port: server.port,
	cpuLimitMillicores: server.cpuLimitMillicores,
	memLimitBytes: server.memLimitBytes,
	diskLimitBytes: server.diskLimitBytes,
	variables: server.variables,
	lastError: server.lastError,
	createdAt: server.createdAt,
} as const;

/** A new server row, minus the columns the repository/service own. */
export type NewServerValues = Omit<
	typeof server.$inferInsert,
	"organizationId" | "createdAt" | "updatedAt"
>;

export type ServerPatch = Partial<
	Pick<
		typeof server.$inferInsert,
		| "name"
		| "state"
		| "port"
		| "imageLabel"
		| "image"
		| "startupCommand"
		| "stopSignal"
		| "eggId"
		| "eggName"
		| "eggVersion"
		| "cpuLimitMillicores"
		| "memLimitBytes"
		| "diskLimitBytes"
		| "variables"
		| "secretVariables"
		| "lastError"
	>
>;

/**
 * The only module that touches the `server` table. Every predicate ANDs
 * `organizationId` (reads *and* writes) so a row in another org is
 * indistinguishable from a missing one — the IDOR backstop from security.md.
 * Reads can additionally scope by `nodeId` for the per-node views.
 */
export const serversRepository = {
	list: (orgId: string) =>
		db
			.select()
			.from(server)
			.where(eq(server.organizationId, orgId))
			.orderBy(desc(server.createdAt)),

	listByNode: (orgId: string, nodeId: string) =>
		db
			.select()
			.from(server)
			.where(and(eq(server.organizationId, orgId), eq(server.nodeId, nodeId)))
			.orderBy(desc(server.createdAt)),

	/** The org's servers, list projection only (no secrets / image / startup). */
	listView: (orgId: string): Promise<ServerListRecord[]> =>
		db
			.select(listColumns)
			.from(server)
			.where(eq(server.organizationId, orgId))
			.orderBy(desc(server.createdAt)),

	/** One node's servers, list projection only. */
	listByNodeView: (
		orgId: string,
		nodeId: string
	): Promise<ServerListRecord[]> =>
		db
			.select(listColumns)
			.from(server)
			.where(and(eq(server.organizationId, orgId), eq(server.nodeId, nodeId)))
			.orderBy(desc(server.createdAt)),

	findById: (orgId: string, id: string) =>
		db
			.select()
			.from(server)
			.where(and(eq(server.id, id), eq(server.organizationId, orgId)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** Insert a server row. The service mints the id (it seals secrets to it). */
	create: async (
		orgId: string,
		values: NewServerValues
	): Promise<ServerRecord> => {
		const [row] = await db
			.insert(server)
			.values({ ...values, organizationId: orgId })
			.returning();
		if (!row) {
			throw new Error("Failed to create server");
		}
		return row;
	},

	update: (orgId: string, id: string, patch: ServerPatch) =>
		db
			.update(server)
			.set(patch)
			.where(and(eq(server.id, id), eq(server.organizationId, orgId)))
			.returning()
			.then((rows) => rows.at(0)),

	remove: (orgId: string, id: string) =>
		db
			.delete(server)
			.where(and(eq(server.id, id), eq(server.organizationId, orgId)))
			.returning({ id: server.id, nodeId: server.nodeId })
			.then((rows) => rows.at(0)),
};
