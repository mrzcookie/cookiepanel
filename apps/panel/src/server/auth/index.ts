import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth/minimal";
import { betterAuth } from "better-auth/minimal";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { recordActivity } from "@/server/activity/record";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { redis } from "@/server/redis";

// Social sign-in shows up only when a provider's credentials are configured.
const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
	socialProviders.github = {
		clientId: env.GITHUB_CLIENT_ID,
		clientSecret: env.GITHUB_CLIENT_SECRET,
	};
}
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
	socialProviders.google = {
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
	};
}

const csv = (value: string | undefined) =>
	value
		?.split(",")
		.map((part) => part.trim())
		.filter(Boolean) ?? [];

const trustedOrigins = csv(env.AUTH_TRUSTED_ORIGINS);
const adminUserIds = csv(env.AUTH_ADMIN_USER_IDS);

/**
 * The Better Auth server instance (server-only). Minimal entry (no Kysely) with
 * the Drizzle adapter; passwordless (magic link + optional social), multi-tenant
 * via the organization plugin, with platform admin via the admin plugin.
 *
 * Sessions and rate-limit counters live in Redis (secondary storage) and are
 * mirrored to Postgres for durability. The TanStack Start cookie plugin stays
 * LAST so Set-Cookie is forwarded. Secure cookies turn on automatically when
 * AUTH_URL is https (so local http dev still works).
 */
export const auth = betterAuth({
	baseURL: env.AUTH_URL,
	secret: env.AUTH_SECRET,
	database: drizzleAdapter(db, { provider: "pg", schema }),

	// Sessions + rate-limit counters in Redis. See src/server/redis.ts.
	secondaryStorage: {
		get: (key) => redis.get(key),
		set: async (key, value, ttl) => {
			if (ttl) {
				await redis.set(key, value, "EX", ttl);
			} else {
				await redis.set(key, value);
			}
		},
		delete: async (key) => {
			await redis.del(key);
		},
	},

	emailAndPassword: { enabled: false },
	socialProviders,
	...(trustedOrigins.length > 0 ? { trustedOrigins } : {}),

	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // refresh daily
		freshAge: 60 * 60, // 1h freshness gate for sensitive actions
		storeSessionInDatabase: true, // durable + queryable alongside Redis
		cookieCache: { enabled: true, maxAge: 60 * 5 },
	},

	// Enabled everywhere (not just prod); counters live in Redis so they hold
	// across instances. Better Auth applies strict defaults to sensitive
	// endpoints (sign-in/sign-up: 3 per 10s) on top of this.
	rateLimit: {
		enabled: true,
		storage: "secondary-storage",
	},

	// OAuth access/refresh tokens are sealed at rest (AES-256-GCM via the secret).
	account: {
		encryptOAuthTokens: true,
	},

	// Audit trail — best-effort writes to the activity log (src/server/activity).
	databaseHooks: {
		session: {
			create: {
				after: async (session) => {
					const activeOrg =
						typeof session.activeOrganizationId === "string"
							? session.activeOrganizationId
							: null;
					await recordActivity({
						category: "auth",
						action: "login",
						userId: session.userId,
						organizationId: activeOrg,
						ip: session.ipAddress ?? null,
					});
				},
			},
		},
	},

	user: {
		additionalFields: {
			// Theme preference, persisted to the user row so it follows the account.
			theme: {
				type: "string",
				required: false,
				defaultValue: "dark",
				input: false,
			},
		},
	},

	advanced: {
		cookiePrefix: "cookiepanel",
		// UUIDs everywhere, so app-table FKs to user/org ids stay UUIDs.
		generateId: () => randomUUID(),
		// Real client IP behind a reverse proxy (for rate limiting / auditing).
		ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
	},

	plugins: [
		organization({
			allowUserToCreateOrganization: true,
			organizationLimit: 10,
			membershipLimit: 100,
			creatorRole: "owner",
			invitationExpiresIn: 60 * 60 * 24 * 7, // 7 days
			invitationLimit: 100,
			cancelPendingInvitationsOnReInvite: true,
			organizationHooks: {
				afterCreateOrganization: async ({ organization: org, user }) => {
					await recordActivity({
						category: "organization",
						action: "organization.created",
						organizationId: org.id,
						userId: user.id,
						actorName: user.name,
						targetType: "organization",
						targetId: org.id,
						targetLabel: org.name,
					});
				},
				afterAddMember: async ({ member: added, user, organization: org }) => {
					await recordActivity({
						category: "member",
						action: "member.joined",
						organizationId: org.id,
						userId: user.id,
						actorName: user.name,
						targetType: "member",
						targetId: added.id,
						targetLabel: user.name,
					});
				},
				afterCreateInvitation: async ({
					invitation: inv,
					inviter,
					organization: org,
				}) => {
					await recordActivity({
						category: "member",
						action: "member.invited",
						organizationId: org.id,
						userId: inviter.id,
						actorName: inviter.name,
						targetType: "invitation",
						targetId: inv.id,
						targetLabel: inv.email,
					});
				},
			},
			sendInvitationEmail: async ({
				email,
				organization: org,
				inviter,
				invitation,
			}) => {
				const who = inviter.user.name || inviter.user.email;
				const url = `${env.AUTH_URL}/accept-invitation/${invitation.id}`;
				await sendEmail({
					to: email,
					subject: `Join ${org.name} on CookiePanel`,
					text: `${who} invited you to join ${org.name} on CookiePanel.\n\nAccept: ${url}\n\nThis invitation expires in 7 days.`,
					html: `<p>${who} invited you to join <strong>${org.name}</strong> on CookiePanel.</p><p><a href="${url}">Accept invitation</a></p><p>This invitation expires in 7 days.</p>`,
				});
			},
		}),
		admin({
			defaultRole: "user",
			adminRoles: ["admin"],
			...(adminUserIds.length > 0 ? { adminUserIds } : {}),
		}),
		magicLink({
			sendMagicLink: async ({ email, url }) => {
				await sendEmail({
					to: email,
					subject: "Your CookiePanel sign-in link",
					text: `Sign in to CookiePanel:\n\n${url}\n\nThis link expires shortly. If you didn't request it, ignore this email.`,
				});
			},
		}),
		tanstackStartCookies(),
	],
});
