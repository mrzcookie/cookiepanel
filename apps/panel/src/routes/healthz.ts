import { createFileRoute } from "@tanstack/react-router";

/**
 * Liveness probe for the container platform (Dokploy / Traefik health checks and
 * the image's own Docker HEALTHCHECK). Deliberately dependency-free — it must
 * not touch Postgres or Redis, so a transient backing-service blip can't flap
 * the container as "unhealthy" and trigger a restart loop. It answers 200 for as
 * long as the HTTP server is accepting requests; readiness against the DB can be
 * a separate probe later if needed.
 */
export const Route = createFileRoute("/healthz")({
	server: {
		handlers: {
			GET: () =>
				new Response("ok", {
					status: 200,
					headers: { "content-type": "text/plain" },
				}),
		},
	},
});
