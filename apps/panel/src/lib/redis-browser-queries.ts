import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { DaemonRead } from "@/lib/domain/nodes";
import type {
	RedisKeyDetail,
	RedisKeyList,
	RedisOverview,
	RedisSetRequest,
} from "@/lib/domain/redis-browser";
import {
	deleteRedisKey as deleteRedisKeyFn,
	flushRedisDb as flushRedisDbFn,
	getRedisKey as getRedisKeyFn,
	getRedisKeys as getRedisKeysFn,
	getRedisOverview as getRedisOverviewFn,
	renameRedisKey as renameRedisKeyFn,
	setRedisKey as setRedisKeyFn,
	setRedisTtl as setRedisTtlFn,
} from "@/server/redis-browser";

// Query factories + hooks + mutation wrappers for the Redis browser. The overview
// (live-ish stats) and the per-key detail use react-query; the keyspace list is
// cursor-paginated, so the component fetches it via `fetchRedisKeys` into local
// state (accumulating pages). All reads degrade to `{ ok: false }` offline. Keyed
// under `["redis", serverId, …]` so one invalidation refreshes a server's views.

export function redisOverviewQueryOptions(serverId: string, db: number) {
	return queryOptions({
		queryKey: ["redis", serverId, "overview", db] as const,
		queryFn: () => getRedisOverviewFn({ data: { serverId, db } }),
		// Stats (memory, clients, hits) drift; poll while focused.
		refetchInterval: 10_000,
		retry: false,
	});
}

export function useRedisOverview(
	serverId: string,
	db: number
): DaemonRead<RedisOverview> | undefined {
	return useQuery(redisOverviewQueryOptions(serverId, db)).data;
}

export function redisKeyQueryOptions(
	serverId: string,
	db: number,
	key: string
) {
	return queryOptions({
		queryKey: ["redis", serverId, "key", db, key] as const,
		queryFn: () => getRedisKeyFn({ data: { serverId, db, key } }),
		enabled: key !== "",
		retry: false,
	});
}

export function useRedisKey(
	serverId: string,
	db: number,
	key: string
): DaemonRead<RedisKeyDetail> | undefined {
	return useQuery(redisKeyQueryOptions(serverId, db, key)).data;
}

/** One page of the keyspace scan (used directly by the list, with cursor paging). */
export function fetchRedisKeys(
	serverId: string,
	db: number,
	pattern: string,
	cursor: string
): Promise<DaemonRead<RedisKeyList>> {
	return getRedisKeysFn({
		data: { serverId, db, pattern, cursor, count: 100 },
	});
}

// ─── mutations ───────────────────────────────────────────────────────────────

export function setRedisKey(
	serverId: string,
	db: number,
	set: RedisSetRequest
) {
	return setRedisKeyFn({ data: { serverId, db, set } });
}

export function deleteRedisKey(serverId: string, db: number, key: string) {
	return deleteRedisKeyFn({ data: { serverId, db, key } });
}

export function renameRedisKey(
	serverId: string,
	db: number,
	key: string,
	newKey: string
) {
	return renameRedisKeyFn({ data: { serverId, db, key, newKey } });
}

export function setRedisTtl(
	serverId: string,
	db: number,
	key: string,
	ttlSeconds: number
) {
	return setRedisTtlFn({ data: { serverId, db, key, ttlSeconds } });
}

export function flushRedisDb(serverId: string, db: number) {
	return flushRedisDbFn({ data: { serverId, db } });
}

/** Refresh every Redis view for a server (after any mutation). */
export function invalidateRedis(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["redis", serverId] });
}
