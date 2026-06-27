import type { SecondaryStorage } from "better-auth";
import { redis } from "@/server/redis";

/**
 * Better Auth secondary storage backed by Upstash Redis — where sessions and
 * rate-limit counters live (keeps them out of Postgres and shared across
 * instances). The contract is string-in / string-out; the client has
 * `automaticDeserialization` off, so `get` hands back exactly the string `set`
 * stored — no JSON round-trip, no object/string ambiguity to defend against.
 */
export const redisSecondaryStorage: SecondaryStorage = {
	get: (key) => redis.get<string>(key),
	set: async (key, value, ttl) => {
		// Better Auth passes TTL in seconds → Upstash's `ex` option.
		if (ttl) {
			await redis.set(key, value, { ex: ttl });
		} else {
			await redis.set(key, value);
		}
	},
	delete: async (key) => {
		await redis.del(key);
	},
};
