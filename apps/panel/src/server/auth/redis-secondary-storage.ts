import type { SecondaryStorage } from "better-auth";
import { redis } from "@/server/redis";

/**
 * Better Auth secondary storage backed by Redis — where sessions and rate-limit
 * counters live (keeps them out of Postgres and shared across instances). The
 * contract is string-in / string-out, which is exactly what Redis stores, so
 * there's no JSON round-trip or object/string ambiguity to defend against.
 */
export const redisSecondaryStorage: SecondaryStorage = {
	get: (key) => redis.get(key),
	set: async (key, value, ttl) => {
		// Better Auth passes TTL in seconds → Redis `EX`.
		if (ttl) {
			await redis.set(key, value, "EX", ttl);
		} else {
			await redis.set(key, value);
		}
	},
	delete: async (key) => {
		await redis.del(key);
	},
};
