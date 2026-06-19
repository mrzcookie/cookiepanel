import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { isPlatformAdmin } from "@/server/auth/guards";
import { db } from "@/server/db";
import { member } from "@/server/db/schema/auth";
import { env } from "@/server/env";

/**
 * Client-callable auth reads.
 *
 * `fetchSession` powers the `_app` route guard: it must run on the server during
 * SSR and on the client during navigation, so it can't call `auth.api` directly
 * (server-only) — a server function bridges both. It returns the user plus the
 * active-organization id (so the guard can route a member with no active org to
 * onboarding), never the raw session record — that holds the session `token`,
 * which shouldn't be handed to client JS / dehydrated into the page.
 *
 * The active-org id rides a cookie cache and can go stale — the org may have been
 * deleted (here or in another session) or the user removed from it — so it's
 * re-verified against live membership before being returned. A stale id reads
 * back as `null`, so the guard routes a user whose only/active org is gone to
 * onboarding instead of letting them through to pages that then fail org-scoped.
 *
 * `fetchIsAdmin` powers the account menu's /admin entry: the same capability check
 * `requireAdmin` enforces, evaluated server-side (the env-bootstrapped admin list
 * never reaches the client), so the menu shows the link to exactly who the guard
 * will admit. Returns false when signed out — never throws — so it's safe to call
 * anywhere.
 *
 * `getEnabledSocialProviders` lets the auth UI render a provider button only when
 * that provider's credentials are configured (mirrors the server's conditional
 * `socialProviders`), so dev installs without OAuth creds don't show dead buttons.
 */
export const fetchSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const session = await auth.api.getSession({
			headers: getRequest().headers,
		});
		if (!session) {
			return null;
		}
		// Re-verify the active org against live membership: the cookie-cached id can
		// point at an org that's since been deleted (its member rows cascade away)
		// or one the user was removed from. Treat a stale id as no active org.
		const activeOrgId = session.session.activeOrganizationId ?? null;
		let activeOrganizationId: string | null = null;
		if (activeOrgId) {
			const [membership] = await db
				.select({ id: member.id })
				.from(member)
				.where(
					and(
						eq(member.userId, session.user.id),
						eq(member.organizationId, activeOrgId)
					)
				)
				.limit(1);
			activeOrganizationId = membership ? activeOrgId : null;
		}
		return { user: session.user, activeOrganizationId };
	}
);

export const fetchIsAdmin = createServerFn({ method: "GET" }).handler(
	async () => {
		const session = await auth.api.getSession({
			headers: getRequest().headers,
		});
		return session ? isPlatformAdmin(session.user) : false;
	}
);

export const getEnabledSocialProviders = createServerFn({
	method: "GET",
}).handler(() => {
	const providers: Array<"github" | "google"> = [];
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		providers.push("github");
	}
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		providers.push("google");
	}
	return providers;
});
