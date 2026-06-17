import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type { AdminMembership, AdminUserRow } from "@/lib/domain/admin";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requireAdmin } from "@/server/auth/guards";
import { usersRepository } from "./repository";

/**
 * Platform users service + server functions — the typed boundary the /admin user
 * panel calls. Each is a thin `auth + validate + delegate` shim: gate on
 * `requireAdmin` (the global capability, NOT org membership — see guards.ts),
 * validate input (Zod), and delegate.
 *
 * User rows come from Better Auth's **admin plugin** (`auth.api.*`), never a
 * direct DB write — so identity changes stay consistent with sessions, the
 * cookie cache, and ban enforcement (per the auth-through-better-auth rule). The
 * only DB reads here are the relational bits that API doesn't return
 * (memberships + last-seen), which live in ./repository. Sensitive actions are
 * audited best-effort to the activity log.
 */

// Up to this many users in one page. The /admin list filters client-side, so we
// fetch a generous window; real server-side pagination/search is deferred.
const LIST_LIMIT = 200;

/** The subset of Better Auth's `UserWithRole` this service reads. */
type AuthUser = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image?: string | null;
	role?: string | null;
	banned?: boolean | null;
	createdAt: Date | string;
};

const byOrgName = (a: AdminMembership, b: AdminMembership) =>
	a.orgName.localeCompare(b.orgName);

/** Map a Better Auth user + its relational data to the client-safe row. */
function toAdminUserRow(
	user: AuthUser,
	memberships: AdminMembership[],
	lastSeen: Date | null
): AdminUserRow {
	// `role` is a comma-list in the admin plugin; admin if "admin" is among them.
	const isAdmin = (user.role ?? "")
		.split(",")
		.some((part) => part.trim() === "admin");
	const createdAt =
		user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt);

	return {
		id: user.id,
		name: user.name,
		email: user.email,
		image: user.image ?? null,
		emailVerified: user.emailVerified,
		role: isAdmin ? "admin" : "user",
		status: user.banned ? "suspended" : "active",
		createdAt: createdAt.toISOString(),
		lastSeenAt: lastSeen ? lastSeen.toISOString() : null,
		memberships: [...memberships].sort(byOrgName),
	};
}

/** Attach memberships + last-seen (batched) and project a set of users. */
async function projectUsers(users: AuthUser[]): Promise<AdminUserRow[]> {
	const ids = users.map((user) => user.id);
	const [memberships, lastSeen] = await Promise.all([
		usersRepository.membershipsForUsers(ids),
		usersRepository.lastSeenForUsers(ids),
	]);
	return users.map((user) =>
		toAdminUserRow(
			user,
			memberships.get(user.id) ?? [],
			lastSeen.get(user.id) ?? null
		)
	);
}

/** Load one user by id, or throw a generic not-found if it's gone. */
async function loadUser(
	headers: Headers,
	userId: string
): Promise<AdminUserRow> {
	let user: AuthUser | null = null;
	try {
		user = await auth.api.getUser({ headers, query: { id: userId } });
	} catch {
		throw new Error("Not found");
	}
	if (!user) {
		throw new Error("Not found");
	}
	const [row] = await projectUsers([user]);
	if (!row) {
		throw new Error("Not found");
	}
	return row;
}

const userIdInput = z.object({ userId: z.string().min(1) });

export const listAdminUsers = createServerFn({ method: "GET" }).handler(
	async () => {
		await requireAdmin();
		const { users } = await auth.api.listUsers({
			headers: getRequest().headers,
			query: { limit: LIST_LIMIT },
		});
		const rows = await projectUsers(users);
		// Newest first; ISO strings sort lexicographically = chronologically.
		return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
);

export const getAdminUser = createServerFn({ method: "GET" })
	.validator(userIdInput)
	.handler(async ({ data }) => {
		await requireAdmin();
		return loadUser(getRequest().headers, data.userId);
	});

const updateInput = z.object({
	userId: z.string().min(1),
	name: z.string().trim().min(1).max(100).optional(),
	email: z.email().optional(),
	emailVerified: z.boolean().optional(),
});

export const updateAdminUser = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		const headers = getRequest().headers;

		const patch: Record<string, unknown> = {};
		if (data.name !== undefined) {
			patch.name = data.name;
		}
		if (data.email !== undefined) {
			patch.email = data.email;
		}
		if (data.emailVerified !== undefined) {
			patch.emailVerified = data.emailVerified;
		}
		// Nothing to change — return the current row so the fn stays well-defined.
		if (Object.keys(patch).length === 0) {
			return loadUser(headers, data.userId);
		}

		const updated = await auth.api.adminUpdateUser({
			headers,
			body: { userId: data.userId, data: patch },
		});
		const [row] = await projectUsers([updated]);
		if (!row) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "account",
			action: "account.updated",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: row.id,
			targetLabel: row.name,
		});
		return row;
	});

const roleInput = z.object({
	userId: z.string().min(1),
	role: z.enum(["user", "admin"]),
});

export const setAdminUserRole = createServerFn({ method: "POST" })
	.validator(roleInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		// Guard self: an admin can't change their own platform role (a foot-gun
		// that could revoke their own access). Enforced server-side, not just hidden.
		if (data.userId === admin.userId) {
			throw new Error("You can't change your own platform role.");
		}

		const { user } = await auth.api.setRole({
			headers: getRequest().headers,
			body: { userId: data.userId, role: data.role },
		});
		const [row] = await projectUsers([user]);
		if (!row) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "account",
			action: "account.role_changed",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: row.id,
			targetLabel: row.name,
			metadata: { role: data.role },
		});
		return row;
	});

const statusInput = z.object({
	userId: z.string().min(1),
	status: z.enum(["active", "suspended"]),
});

export const setAdminUserStatus = createServerFn({ method: "POST" })
	.validator(statusInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		if (data.userId === admin.userId) {
			throw new Error("You can't suspend your own account.");
		}

		const headers = getRequest().headers;
		const suspend = data.status === "suspended";
		// Suspend = ban (Better Auth also revokes the user's sessions); reactivate
		// = unban. Their orgs and servers keep running either way.
		const { user } = suspend
			? await auth.api.banUser({ headers, body: { userId: data.userId } })
			: await auth.api.unbanUser({ headers, body: { userId: data.userId } });
		const [row] = await projectUsers([user]);
		if (!row) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "account",
			action: suspend ? "account.suspended" : "account.reactivated",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: row.id,
			targetLabel: row.name,
		});
		return row;
	});

export const deleteAdminUser = createServerFn({ method: "POST" })
	.validator(userIdInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		if (data.userId === admin.userId) {
			throw new Error("You can't delete your own account here.");
		}

		const headers = getRequest().headers;
		// Capture a label for the audit trail before the row is gone.
		let label = data.userId;
		try {
			const user = await auth.api.getUser({
				headers,
				query: { id: data.userId },
			});
			label = user?.name ?? user?.email ?? data.userId;
		} catch {
			// Best-effort label only; proceed with the removal regardless.
		}

		await auth.api.removeUser({ headers, body: { userId: data.userId } });

		await recordActivity({
			category: "account",
			action: "account.deleted",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: data.userId,
			targetLabel: label,
		});
		return { id: data.userId };
	});
