import { Redis } from "@upstash/redis";
import { env } from "@/server/env";

/**
 * Shared Upstash Redis client (server-only — it holds the REST token, so it must
 * never reach the client bundle). Backs Better Auth secondary storage (sessions
 * + rate-limit counters); see ./auth/redis-secondary-storage.ts.
 *
 * Talks the Upstash REST API over HTTP, so it's connectionless — nothing to pool
 * or keep warm, which suits serverless. Built from the validated server env
 * rather than `Redis.fromEnv()` so the credentials go through t3-env (and stay
 * out of the client bundle).
 *
 * `automaticDeserialization` is OFF on purpose: Better Auth stores and expects
 * raw JSON strings, so we keep Redis a plain string store — `get` returns exactly
 * what `set` wrote, with no SDK-side JSON.parse turning values back into objects.
 */
export const redis = new Redis({
	url: env.UPSTASH_REDIS_REST_URL,
	token: env.UPSTASH_REDIS_REST_TOKEN,
	automaticDeserialization: false,
});
