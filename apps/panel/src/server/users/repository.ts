import { eq, inArray, max } from "drizzle-orm";
import type { AdminMembership, MemberRole } from "@/lib/domain/admin";
import { db } from "@/server/db";
import { member, organization, session } from "@/server/db/schema/auth";

/**
 * The only module that touches the DB for the admin users views. The user rows
 * themselves come from Better Auth's admin API (`auth.api.*`) — this layer just
 * supplies the relational bits that API doesn't return: a user's org memberships
 * and their last-seen time. Both reads are batched by a set of user ids (so the
 * list view stays one query each, not N+1) and returned grouped by user id.
 *
 * Unlike the org-scoped repositories, this is **deliberately not org-scoped**:
 * the platform admin surface spans every org. Its server fns gate on
 * `requireAdmin` instead (see ./index.ts).
 */
export const usersRepository = {
	/** Org memberships (with org names + the per-org role) grouped by user id. */
	membershipsForUsers: async (
		userIds: string[]
	): Promise<Map<string, AdminMembership[]>> => {
		const grouped = new Map<string, AdminMembership[]>();
		if (userIds.length === 0) {
			return grouped;
		}
		const rows = await db
			.select({
				userId: member.userId,
				role: member.role,
				orgId: organization.id,
				orgName: organization.name,
			})
			.from(member)
			.innerJoin(organization, eq(member.organizationId, organization.id))
			.where(inArray(member.userId, userIds));

		for (const row of rows) {
			const list = grouped.get(row.userId) ?? [];
			list.push({
				orgId: row.orgId,
				orgName: row.orgName,
				role: row.role as MemberRole,
			});
			grouped.set(row.userId, list);
		}
		return grouped;
	},

	/**
	 * The most recent session activity per user — an approximate "last seen".
	 * Sessions are deleted on expiry/sign-out, so a user with none maps to nothing
	 * (the service reads that as null → "never").
	 */
	lastSeenForUsers: async (userIds: string[]): Promise<Map<string, Date>> => {
		const seen = new Map<string, Date>();
		if (userIds.length === 0) {
			return seen;
		}
		const rows = await db
			.select({ userId: session.userId, lastSeen: max(session.updatedAt) })
			.from(session)
			.where(inArray(session.userId, userIds))
			.groupBy(session.userId);

		for (const row of rows) {
			if (row.lastSeen) {
				seen.set(row.userId, row.lastSeen);
			}
		}
		return seen;
	},
};
