import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "@/server/auth";
import { env } from "@/server/env";

/**
 * Client-callable auth reads.
 *
 * `fetchSession` powers the `_app` route guard: it must run on the server during
 * SSR and on the client during navigation, so it can't call `auth.api` directly
 * (server-only) — a server function bridges both. It returns only the user (or
 * null), never the raw session record — that holds the session `token`, which
 * shouldn't be handed to client JS / dehydrated into the page.
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
		return session ? { user: session.user } : null;
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
