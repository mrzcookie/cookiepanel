import Redis from "ioredis";
import { env } from "@/server/env";

/**
 * Shared Redis client (server-only). Backs Better Auth secondary storage
 * (sessions + rate-limit counters); see ./auth/redis-secondary-storage.ts.
 *
 * A long-lived TCP connection — the panel runs as a persistent Bun process, not
 * serverless, so a plain Redis beats the old Upstash REST shim. `lazyConnect`
 * defers the connection to the first command (so importing this at build time
 * never dials), and it's cached on globalThis so dev HMR doesn't pile up
 * connections.
 */
const globalForRedis = globalThis as unknown as { __raptorRedis?: Redis };

export const redis: Redis =
	globalForRedis.__raptorRedis ??
	new Redis(env.REDIS_URL, {
		lazyConnect: true,
		// Fail a command after a few retries / a timeout rather than queueing it
		// forever — so a Redis outage degrades the auth path instead of hanging it.
		maxRetriesPerRequest: 3,
		commandTimeout: 5_000,
	});

if (env.NODE_ENV !== "production") {
	globalForRedis.__raptorRedis = redis;
}
