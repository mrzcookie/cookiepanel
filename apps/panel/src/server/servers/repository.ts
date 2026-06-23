import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { server } from "@/server/db/schema/servers";

export type ServerRecord = typeof server.$inferSelect;

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
		| "templateId"
		| "templateName"
		| "templateVersion"
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
