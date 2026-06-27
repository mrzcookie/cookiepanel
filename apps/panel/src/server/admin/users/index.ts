import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import type {
	AdminMembership,
	AdminUserConnection,
	AdminUserRow,
	AdminUserSession,
} from "@/lib/domain/admin";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requirePlatformAdmin } from "@/server/auth/guards";
import { deleteOwnedObject } from "@/server/storage";
import { validateImageUpload } from "@/server/storage/image-upload";
import { replaceManagedImage } from "@/server/storage/managed-image";
import { usersRepository } from "./repository";

/** Storage namespace for avatar objects (shared with the account-level avatar). */
const AVATAR_PREFIX = "avatars";

/**
 * Platform users service + server functions — the typed boundary the /admin user
 * panel calls. Each is a thin `auth + validate + delegate` shim: gate on
 * `requirePlatformAdmin` (the global capability, NOT org membership — see guards.ts),
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
	const isPlatformAdmin = (user.role ?? "")
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
		role: isPlatformAdmin ? "admin" : "user",
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

/** Best-effort display label for the audit trail (name → email → id). */
async function userLabel(headers: Headers, userId: string): Promise<string> {
	try {
		const user = await auth.api.getUser({ headers, query: { id: userId } });
		return user?.name ?? user?.email ?? userId;
	} catch {
		return userId;
	}
}

const userIdInput = z.object({ userId: z.string().min(1) });

export const listAdminUsers = createServerFn({ method: "GET" }).handler(
	async () => {
		await requirePlatformAdmin();
		const { users } = await auth.api.listUsers({
			headers: getRequest().headers,
			query: { limit: LIST_LIMIT },
		});
		const rows = await projectUsers(users);
		// Newest first; ISO strings sort lexicographically = chronologically.
		return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
);

/** Just the platform user count, for the admin overview's stat tile — avoids
 * listing + projecting every user (membership/last-seen joins) for a number. */
export const countAdminUsers = createServerFn({ method: "GET" }).handler(
	async () => {
		await requirePlatformAdmin();
		return usersRepository.count();
	}
);

const updateInput = z.object({
	userId: z.string().min(1),
	name: z.string().trim().min(1).max(100).optional(),
	email: z.email().optional(),
	emailVerified: z.boolean().optional(),
});

export const updateAdminUser = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
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
		const admin = await requirePlatformAdmin();

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
		const admin = await requirePlatformAdmin();

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
		const admin = await requirePlatformAdmin();

		const headers = getRequest().headers;
		// Capture a label for the audit trail before the row is gone.
		const label = await userLabel(headers, data.userId);

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

/**
 * Set a user's avatar from the admin console. Same shape as the account-level
 * `uploadAvatar` (S3 put → persist the URL → drop the old object), but the URL is
 * written with the admin plugin's `adminUpdateUser` (target `userId`, not the
 * session) and the storage key is namespaced by the **target** user. Expects a
 * multipart body carrying `file` + `userId`.
 */
function validateAvatarUpload(input: unknown): { file: File; userId: string } {
	const { file } = validateImageUpload(input);
	const userId = (input as FormData).get("userId");
	if (typeof userId !== "string" || userId.length === 0) {
		throw new Error("No user provided");
	}
	return { file, userId };
}

export const setAdminUserAvatar = createServerFn({ method: "POST" })
	.validator(validateAvatarUpload)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
		const headers = getRequest().headers;

		// Load first: a generic not-found on a bad id, plus the prior avatar to clean up.
		const before = await loadUser(headers, data.userId);

		let updated!: AuthUser;
		await replaceManagedImage({
			prefix: AVATAR_PREFIX,
			ownerId: data.userId,
			file: data.file,
			previousUrl: before.image,
			// Persist through Better Auth (it owns `user.image`) so the target user's
			// session + cookie cache stay current.
			persist: async (image) => {
				updated = await auth.api.adminUpdateUser({
					headers,
					body: { userId: data.userId, data: { image } },
				});
			},
			errorMessage: "Couldn't update the avatar. Please try again.",
		});

		const [row] = await projectUsers([updated]);
		if (!row) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "account",
			action: "account.avatar_updated",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: row.id,
			targetLabel: row.name,
		});
		return row;
	});

export const removeAdminUserAvatar = createServerFn({ method: "POST" })
	.validator(userIdInput)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
		const headers = getRequest().headers;
		const before = await loadUser(headers, data.userId);

		// Clear through Better Auth (it owns `user.image`); `image: null` removes it.
		const updated = await auth.api.adminUpdateUser({
			headers,
			body: { userId: data.userId, data: { image: null } },
		});

		// Best-effort: drop the prior avatar, but only when it's one we own.
		await deleteOwnedObject(before.image, AVATAR_PREFIX);

		const [row] = await projectUsers([updated]);
		if (!row) {
			throw new Error("Not found");
		}

		// Only audit a real removal — no spurious entry when there was no avatar.
		if (before.image) {
			await recordActivity({
				category: "account",
				action: "account.avatar_removed",
				userId: admin.userId,
				actorName: admin.userName,
				targetType: "user",
				targetId: row.id,
				targetLabel: row.name,
			});
		}
		return row;
	});

/** A user's linked social logins (client-safe — provider keys, never tokens). The
 * `credential` provider (email/password) is filtered out: this is the OAuth list. */
export const listAdminUserAccounts = createServerFn({ method: "GET" })
	.validator(userIdInput)
	.handler(async ({ data }): Promise<AdminUserConnection[]> => {
		await requirePlatformAdmin();
		const rows = await usersRepository.accountsForUser(data.userId);
		return rows
			.filter((row) => row.providerId !== "credential")
			.map((row) => ({
				id: row.id,
				providerId: row.providerId,
				linkedAt: row.createdAt.toISOString(),
			}));
	});

const unlinkInput = z.object({
	userId: z.string().min(1),
	accountId: z.string().min(1),
});

/**
 * Disconnect one of a user's social logins. Better Auth's admin plugin has no
 * unlink endpoint, so this deletes the `account` row through the repository — the
 * one deliberate direct write to an auth-owned table, gated on `requirePlatformAdmin` and
 * audited. The account stays reachable via magic link (the app is passwordless),
 * so there's no lock-out to guard against.
 */
export const unlinkAdminUserAccount = createServerFn({ method: "POST" })
	.validator(unlinkInput)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
		const removed = await usersRepository.deleteAccount(
			data.userId,
			data.accountId
		);
		if (!removed) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "account",
			action: "account.connection_removed",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: data.userId,
			targetLabel: await userLabel(getRequest().headers, data.userId),
			metadata: { provider: removed.providerId },
		});
		return { id: data.accountId };
	});

/** A user's active sessions (client-safe — never the token). Newest first; the
 * admin's own current session is flagged so the UI can mark it "this device". */
export const listAdminUserSessions = createServerFn({ method: "GET" })
	.validator(userIdInput)
	.handler(async ({ data }): Promise<AdminUserSession[]> => {
		const admin = await requirePlatformAdmin();
		const { sessions } = await auth.api.listUserSessions({
			headers: getRequest().headers,
			body: { userId: data.userId },
		});
		return sessions
			.map((session) => ({
				id: session.id,
				ipAddress: session.ipAddress ?? null,
				userAgent: session.userAgent ?? null,
				createdAt: new Date(session.createdAt).toISOString(),
				expiresAt: new Date(session.expiresAt).toISOString(),
				isCurrent: session.token === admin.sessionToken,
			}))
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	});

const sessionInput = z.object({
	userId: z.string().min(1),
	sessionId: z.string().min(1),
});

/** Revoke one session. The admin API revokes by token (never exposed to the
 * client), so we resolve the id → token from the user's session list first. */
export const revokeAdminUserSession = createServerFn({ method: "POST" })
	.validator(sessionInput)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
		const headers = getRequest().headers;
		const { sessions } = await auth.api.listUserSessions({
			headers,
			body: { userId: data.userId },
		});
		const target = sessions.find((session) => session.id === data.sessionId);
		if (!target) {
			throw new Error("Not found");
		}

		await auth.api.revokeUserSession({
			headers,
			body: { sessionToken: target.token },
		});

		await recordActivity({
			category: "account",
			action: "account.session_revoked",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: data.userId,
			targetLabel: await userLabel(headers, data.userId),
		});
		return { id: data.sessionId };
	});

/** Revoke every active session for a user (clear all / force sign-out). Clean via
 * the admin API; the account itself is untouched, so they can sign back in. */
export const revokeAdminUserSessions = createServerFn({ method: "POST" })
	.validator(userIdInput)
	.handler(async ({ data }) => {
		const admin = await requirePlatformAdmin();
		const headers = getRequest().headers;
		await auth.api.revokeUserSessions({
			headers,
			body: { userId: data.userId },
		});

		await recordActivity({
			category: "account",
			action: "account.sessions_revoked",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "user",
			targetId: data.userId,
			targetLabel: await userLabel(headers, data.userId),
		});
		return { ok: true };
	});
