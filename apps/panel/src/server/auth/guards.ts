import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { member } from "@/server/db/schema/auth";
import { env } from "@/server/env";

/**
 * Server-side auth guards, called by server functions before any scoped op.
 * They throw on failure. Per security.md (defense in depth), the session's
 * active-org id is never trusted alone — membership is re-queried in the DB,
 * since that id rides a cookie cache and can go stale.
 */

const adminUserIds = (env.AUTH_ADMIN_USER_IDS ?? "")
	.split(",")
	.map((part) => part.trim())
	.filter(Boolean);

export async function requireSession() {
	const session = await auth.api.getSession({ headers: getRequest().headers });
	if (!session) {
		throw new Error("Unauthorized");
	}
	return session;
}

/** The authenticated user + their verified active organization. */
export async function requireOrg() {
	const session = await requireSession();
	const orgId = session.session.activeOrganizationId;
	if (!orgId) {
		throw new Error("No active organization");
	}

	const [membership] = await db
		.select({ id: member.id })
		.from(member)
		.where(
			and(eq(member.userId, session.user.id), eq(member.organizationId, orgId))
		)
		.limit(1);

	if (!membership) {
		// Generic — a non-member must not learn whether the org exists.
		throw new Error("Not found");
	}

	return {
		userId: session.user.id,
		userName: session.user.name,
		orgId,
	};
}

/** A platform admin (admin-plugin role, or an env-bootstrapped admin id). */
export async function requireAdmin() {
	const session = await requireSession();
	const isAdmin =
		session.user.role === "admin" || adminUserIds.includes(session.user.id);
	if (!isAdmin) {
		throw new Error("Forbidden");
	}
	return { userId: session.user.id, userName: session.user.name };
}
