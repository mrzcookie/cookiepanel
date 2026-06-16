import { createMiddleware, createStart } from "@tanstack/react-start";
import { auth } from "@/server/auth";

/**
 * Mount the Better Auth HTTP handler.
 *
 * This TanStack Start version has no server-route file API, so a request
 * middleware forwards every `/api/auth/*` request to Better Auth's handler —
 * returning its Response short-circuits the router. All other requests pass
 * through untouched via `next()`.
 */
const authHandler = createMiddleware({ type: "request" }).server(
	({ request, next }) => {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/auth/")) {
			return auth.handler(request);
		}
		return next();
	}
);

export const startInstance = createStart(() => ({
	requestMiddleware: [authHandler],
}));
