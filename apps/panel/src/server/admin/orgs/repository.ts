import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { member, organization, user } from "@/server/db/schema/auth";
import { node } from "@/server/db/schema/nodes";

export type OrgRecord = typeof organization.$inferSelect;

/** One member row joined to its user, for the admin members panel. */
export type OrgMemberRecord = {
	id: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	role: string;
	joinedAt: Date;
};

/**
 * The only module that touches the DB for the admin orgs views. Unlike the
 * org-scoped repositories (nodes, …), this is **deliberately not org-scoped**:
 * the platform admin surface spans every organization, so it reads and writes
 * org rows across tenants. Its service gates on `requirePlatformAdmin` instead (see
 * ./index.ts).
 *
 * It also owns the org **mutations** that the admin panel needs (rename / logo /
 * delete). Better Auth's organization plugin has no cross-org admin endpoint —
 * its `updateOrganization`/`deleteOrganization` require the caller to be a member
 * of that org with permission — so a platform admin who isn't a member can't go
 * through it. These writes therefore touch the `organization` table directly: the
 * deliberate, isolated exception to the auth-through-Better-Auth rule (the service
 * that calls them gates on `requirePlatformAdmin` and audits every change). It's safe
 * because the org row isn't mirrored into the session/cookie cache the way user
 * identity is — only the active-org *id* is, and that's reconciled on read by
 * `requireOrg`.
 */
export const orgsRepository = {
	/** Every organization, newest first. */
	list: () =>
		db.select().from(organization).orderBy(desc(organization.createdAt)),

	findById: (id: string) =>
		db
			.select()
			.from(organization)
			.where(eq(organization.id, id))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** Member counts grouped by org id (one query, not N+1). */
	memberCounts: async (orgIds: string[]): Promise<Map<string, number>> => {
		const counts = new Map<string, number>();
		if (orgIds.length === 0) {
			return counts;
		}
		const rows = await db
			.select({
				orgId: member.organizationId,
				count: sql<number>`count(*)::int`,
			})
			.from(member)
			.where(inArray(member.organizationId, orgIds))
			.groupBy(member.organizationId);
		for (const row of rows) {
			counts.set(row.orgId, row.count);
		}
		return counts;
	},

	/** Registered-node counts grouped by org id (one query, not N+1). */
	nodeCounts: async (orgIds: string[]): Promise<Map<string, number>> => {
		const counts = new Map<string, number>();
		if (orgIds.length === 0) {
			return counts;
		}
		const rows = await db
			.select({
				orgId: node.organizationId,
				count: sql<number>`count(*)::int`,
			})
			.from(node)
			.where(inArray(node.organizationId, orgIds))
			.groupBy(node.organizationId);
		for (const row of rows) {
			counts.set(row.orgId, row.count);
		}
		return counts;
	},

	/** A single org's members, joined to the user's display fields. */
	membersForOrg: (orgId: string): Promise<OrgMemberRecord[]> =>
		db
			.select({
				id: member.id,
				userId: member.userId,
				name: user.name,
				email: user.email,
				image: user.image,
				role: member.role,
				joinedAt: member.createdAt,
			})
			.from(member)
			.innerJoin(user, eq(member.userId, user.id))
			.where(eq(member.organizationId, orgId)),

	/** The org's current logo URL, for cleanup of the object being replaced. */
	currentLogo: (orgId: string): Promise<string | null> =>
		db
			.select({ logo: organization.logo })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1)
			.then((rows) => rows.at(0)?.logo ?? null),

	updateName: (orgId: string, name: string) =>
		db
			.update(organization)
			.set({ name })
			.where(eq(organization.id, orgId))
			.returning()
			.then((rows) => rows.at(0)),

	updateLogo: (orgId: string, logo: string | null) =>
		db
			.update(organization)
			.set({ logo })
			.where(eq(organization.id, orgId))
			.returning()
			.then((rows) => rows.at(0)),

	/**
	 * Delete an org. Members, invitations, nodes, and its activity-log entries all
	 * cascade off the `organization` FK. Returns the removed row's id + name (for
	 * the audit trail), or null if nothing matched.
	 */
	remove: (orgId: string) =>
		db
			.delete(organization)
			.where(eq(organization.id, orgId))
			.returning({ id: organization.id, name: organization.name })
			.then((rows) => rows.at(0) ?? null),
};
