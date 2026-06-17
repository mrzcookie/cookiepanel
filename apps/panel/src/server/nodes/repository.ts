import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { node } from "@/server/db/schema/nodes";

export type NodeRecord = typeof node.$inferSelect;
type NewNodeValues = Omit<typeof node.$inferInsert, "id" | "organizationId">;
type NodePatch = Partial<
	Pick<
		typeof node.$inferInsert,
		| "name"
		| "fqdn"
		| "daemonPort"
		| "managed"
		| "capCpuCores"
		| "capMemBytes"
		| "capDiskBytes"
	>
>;

/**
 * The only module that touches the `node` table. Every method is **org-scoped**:
 * `organizationId` is ANDed into every predicate (reads *and* writes), so a row
 * in another org is indistinguishable from a missing one — the IDOR backstop
 * from security.md. The service above is responsible for resolving the orgId
 * from a verified session; this layer just trusts and scopes by it.
 */
export const nodesRepository = {
	list: (orgId: string) =>
		db
			.select()
			.from(node)
			.where(eq(node.organizationId, orgId))
			.orderBy(desc(node.createdAt)),

	findById: (orgId: string, id: string) =>
		db
			.select()
			.from(node)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.limit(1)
			.then((rows) => rows.at(0)),

	create: async (orgId: string, values: NewNodeValues) => {
		const [row] = await db
			.insert(node)
			.values({ ...values, id: randomUUID(), organizationId: orgId })
			.returning();
		if (!row) {
			throw new Error("Failed to create node");
		}
		return row;
	},

	update: (orgId: string, id: string, patch: NodePatch) =>
		db
			.update(node)
			.set(patch)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.returning()
			.then((rows) => rows.at(0)),

	remove: (orgId: string, id: string) =>
		db
			.delete(node)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.returning({ id: node.id })
			.then((rows) => rows.at(0)),
};
