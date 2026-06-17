import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "@/server/auth";
import { isPlatformAdmin } from "@/server/auth/guards";
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
		return session
			? {
					user: session.user,
					activeOrganizationId: session.session.activeOrganizationId ?? null,
				}
			: null;
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
