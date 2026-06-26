import type { components } from "@raptor/contract";

// Redis "Browser" domain: the panel-facing types are the generated contract
// schemas (the daemon's wire shapes), plus a few pure helpers. The Redis face of
// the single `database:browser` add-on (engine resolved via databaseEngine()).

type S = components["schemas"];
export type RedisOverview = S["RedisOverview"];
export type RedisKeyList = S["RedisKeyList"];
export type RedisKeySummary = S["RedisKeySummary"];
export type RedisKeyDetail = S["RedisKeyDetail"];
export type RedisSetRequest = S["RedisSetRequest"];

/** The types the editor can create/replace (a stream is read-only here). */
export const REDIS_SET_TYPES = [
	"string",
	"hash",
	"list",
	"set",
	"zset",
] as const;
export type RedisSetType = (typeof REDIS_SET_TYPES)[number];

/** Collections are measured in elements; strings in bytes. */
export function isCollection(type: string): boolean {
	return type !== "string" && type !== "none";
}

/** A human TTL. The daemon reports seconds, or a negative value for "no expiry". */
export function ttlLabel(ttlSeconds: number): string {
	if (ttlSeconds < 0) {
		return "Never";
	}
	if (ttlSeconds < 60) {
		return `${ttlSeconds}s`;
	}
	if (ttlSeconds < 3600) {
		return `${Math.floor(ttlSeconds / 60)}m`;
	}
	if (ttlSeconds < 86_400) {
		return `${Math.floor(ttlSeconds / 3600)}h`;
	}
	return `${Math.floor(ttlSeconds / 86_400)}d`;
}

/** Cache hit rate as a whole-percent string, or "—" with no traffic yet. */
export function hitRate(hits: number, misses: number): string {
	const total = hits + misses;
	if (total === 0) {
		return "—";
	}
	return `${Math.round((hits / total) * 100)}%`;
}
