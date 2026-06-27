import { and, count, eq, inArray, max } from "drizzle-orm";
import type { AdminMembership, MemberRole } from "@/lib/domain/admin";
import { db } from "@/server/db";
import {
	account,
	member,
	organization,
	session,
	user,
} from "@/server/db/schema/auth";

/**
 * The only module that touches the DB for the admin users views. The user rows
 * themselves come from Better Auth's admin API (`auth.api.*`) — this layer just
 * supplies the relational bits that API doesn't return: a user's org memberships
 * and their last-seen time. Both reads are batched by a set of user ids (so the
 * list view stays one query each, not N+1) and returned grouped by user id.
 *
 * It also owns the **linked-account read/delete** the admin connections panel
 * needs: Better Auth's admin plugin has no endpoint to list or unlink another
 * user's OAuth login, so that one operation touches the `account` table directly
 * here — the deliberate, isolated exception to the auth-through-Better-Auth rule
 * (the service that calls it gates on `requirePlatformAdmin` and audits the removal).
 *
 * Unlike the org-scoped repositories, this is **deliberately not org-scoped**:
 * the platform admin surface spans every org. Its server fns gate on
 * `requirePlatformAdmin` instead (see ./index.ts).
 */
export const usersRepository = {
	/** Total platform user count — for the admin overview's "Users" stat tile, so
	 * it doesn't have to fetch + project the whole user list just to read length. */
	count: async (): Promise<number> => {
		const [row] = await db.select({ value: count() }).from(user);
		return row?.value ?? 0;
	},

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

	/** A user's linked-account rows (provider + when linked). No tokens leave here. */
	accountsForUser: (userId: string) =>
		db
			.select({
				id: account.id,
				providerId: account.providerId,
				createdAt: account.createdAt,
			})
			.from(account)
			.where(eq(account.userId, userId)),

	/**
	 * Unlink one login by deleting its `account` row, scoped by `userId` so a
	 * mismatched id can't reach another account's row. Returns the removed row's
	 * provider (for the audit trail), or null if nothing matched.
	 */
	deleteAccount: async (
		userId: string,
		accountId: string
	): Promise<{ providerId: string } | null> => {
		const [removed] = await db
			.delete(account)
			.where(and(eq(account.id, accountId), eq(account.userId, userId)))
			.returning({ providerId: account.providerId });
		return removed ?? null;
	},
};
