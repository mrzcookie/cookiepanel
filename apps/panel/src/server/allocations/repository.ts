import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { allocation } from "@/server/db/schema/allocations";

export type AllocationRecord = typeof allocation.$inferSelect;
export type NewAllocationValues = Omit<
	typeof allocation.$inferInsert,
	"id" | "organizationId" | "createdAt"
>;

/**
 * The only module that touches the `allocation` table. Every predicate ANDs
 * `organizationId` (the IDOR backstop). The DB's unique `(node, port, protocol)`
 * index is the authoritative double-bind guard; `create` surfaces a conflict as
 * a clear error.
 */
export const allocationsRepository = {
	listByNode: (orgId: string, nodeId: string) =>
		db
			.select()
			.from(allocation)
			.where(
				and(eq(allocation.organizationId, orgId), eq(allocation.nodeId, nodeId))
			)
			.orderBy(asc(allocation.port)),

	listByServer: (orgId: string, serverId: string) =>
		db
			.select()
			.from(allocation)
			.where(
				and(
					eq(allocation.organizationId, orgId),
					eq(allocation.serverId, serverId)
				)
			)
			.orderBy(asc(allocation.port)),

	findById: (orgId: string, id: string) =>
		db
			.select()
			.from(allocation)
			.where(and(eq(allocation.id, id), eq(allocation.organizationId, orgId)))
			.limit(1)
			.then((rows) => rows.at(0)),

	create: async (
		orgId: string,
		values: NewAllocationValues
	): Promise<AllocationRecord> => {
		const [row] = await db
			.insert(allocation)
			.values({ ...values, id: randomUUID(), organizationId: orgId })
			.returning();
		if (!row) {
			throw new Error("Failed to create allocation");
		}
		return row;
	},

	remove: (orgId: string, id: string) =>
		db
			.delete(allocation)
			.where(and(eq(allocation.id, id), eq(allocation.organizationId, orgId)))
			.returning()
			.then((rows) => rows.at(0)),
};
