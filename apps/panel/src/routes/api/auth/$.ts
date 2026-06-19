import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/server/auth";

/**
 * Better Auth's HTTP handler, mounted as a catch-all server route — the
 * integration Better Auth documents for TanStack Start. Every `/api/auth/*`
 * request (sign-in, magic-link, OAuth callbacks, get-session, …) is forwarded to
 * `auth.handler`, which routes internally by method + path and returns the
 * `Response`. There's no client component: `server.handlers` makes this a
 * server-only route, intercepted before the router renders.
 */
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => auth.handler(request),
			POST: ({ request }) => auth.handler(request),
		},
	},
});
