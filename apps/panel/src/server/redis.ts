import { Redis } from "ioredis";
import { env } from "@/server/env";

/**
 * Shared Redis client (server-only). Backs Better Auth secondary storage
 * (sessions + rate-limit counters) and is available for other server-side
 * caching. Cached on globalThis in dev so HMR re-evaluating this module doesn't
 * open a new connection each reload.
 */
const globalForRedis = globalThis as unknown as {
	__raptorpanelRedis?: Redis;
};

function createRedis() {
	const client = new Redis(env.REDIS_URL, {
		// Connect on first command, not at import — avoids boot-time noise when
		// the dev infra isn't up yet.
		lazyConnect: true,
		// Fail commands fast instead of queueing forever when Redis is down.
		maxRetriesPerRequest: 3,
	});
	// Without a listener, connection errors become unhandled and can crash the
	// process; surface them instead.
	client.on("error", (err) => {
		console.error("[redis] connection error:", err.message);
	});
	return client;
}

export const redis = globalForRedis.__raptorpanelRedis ?? createRedis();

if (env.NODE_ENV !== "production") {
	globalForRedis.__raptorpanelRedis = redis;
}
