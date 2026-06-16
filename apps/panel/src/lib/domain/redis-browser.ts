// Redis "Key Browser" domain types + pure helpers. The Redis face of the single
// `database:browser` add-on (engine resolved via databaseEngine()): browse the
// keyspace, inspect a key's type / TTL / value, and create or delete keys. Types
// only — stub data lives in `redis-browser-store.ts`.

export const REDIS_TYPES = [
	"string",
	"hash",
	"list",
	"set",
	"zset",
	"stream",
] as const;
export type RedisType = (typeof REDIS_TYPES)[number];

export type RedisKey = {
	key: string;
	type: RedisType;
	/** Seconds until expiry; null = no expiry (persists). */
	ttlSeconds: number | null;
	/** Value size in bytes for a string; element count for a collection. */
	length: number;
	/** A short preview of the value. */
	preview: string;
};

export type RedisData = {
	keys: RedisKey[];
	usedMemoryBytes: number;
	maxMemoryBytes: number;
	hits: number;
	misses: number;
};

/** Collections are measured in elements; strings in bytes. */
export function isCollection(type: RedisType): boolean {
	return type !== "string";
}

/** A human TTL: "Never", "45s", "12m", "2h", "3d". */
export function ttlLabel(ttlSeconds: number | null): string {
	if (ttlSeconds === null) {
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
export function hitRate(data: RedisData): string {
	const total = data.hits + data.misses;
	if (total === 0) {
		return "—";
	}
	return `${Math.round((data.hits / total) * 100)}%`;
}
