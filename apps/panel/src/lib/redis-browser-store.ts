import { useSyncExternalStore } from "react";
import type { RedisData, RedisKey } from "@/lib/redis-browser";

// Mutable client-side stub store for the Redis Key Browser — a stand-in for what
// the daemon would read from the live instance. Keyed by server: each starts
// from one demo keyspace (DEFAULT_DATA) and gets its own copy on first change.
// Browser-only; SSR + the first client render see the shared default.

const MiB = 1024 ** 2;

const DEFAULT_DATA: RedisData = {
	usedMemoryBytes: 48 * MiB,
	maxMemoryBytes: 256 * MiB,
	hits: 184_230,
	misses: 9_120,
	keys: [
		{
			key: "session:8f3a1c9e4b7d",
			type: "string",
			ttlSeconds: 1_740,
			length: 412,
			preview: '{"uid":18342,"role":"admin","csrf":"a1b2c3"}',
		},
		{
			key: "session:2d4f6a8b0c1e",
			type: "string",
			ttlSeconds: 920,
			length: 388,
			preview: '{"uid":18510,"role":"member"}',
		},
		{
			key: "cache:user:18342",
			type: "string",
			ttlSeconds: 540,
			length: 1_204,
			preview: '{"id":18342,"name":"Jane Cooper","email":"jane@…"}',
		},
		{
			key: "ratelimit:ip:203.0.113.10",
			type: "string",
			ttlSeconds: 47,
			length: 2,
			preview: "7",
		},
		{
			key: "queue:emails",
			type: "list",
			ttlSeconds: null,
			length: 142,
			preview: "[ welcome#9f3a, receipt#2d4f, digest#7b21, … ]",
		},
		{
			key: "online:users",
			type: "set",
			ttlSeconds: null,
			length: 87,
			preview: "{ 18342, 18510, 17904, 18233, … }",
		},
		{
			key: "leaderboard:weekly",
			type: "zset",
			ttlSeconds: 172_800,
			length: 500,
			preview: "{ player:18510 → 9920, player:18342 → 8740, … }",
		},
		{
			key: "user:18342:profile",
			type: "hash",
			ttlSeconds: null,
			length: 9,
			preview: "{ name: Jane Cooper, plan: pro, seats: 8, … }",
		},
		{
			key: "config:flags",
			type: "hash",
			ttlSeconds: null,
			length: 14,
			preview: "{ new_dashboard: on, beta_search: off, … }",
		},
		{
			key: "stream:events",
			type: "stream",
			ttlSeconds: null,
			length: 2_048,
			preview: "1718-0 … 1718-2047 (2,048 entries)",
		},
		{
			key: "counter:signups:2026-06",
			type: "string",
			ttlSeconds: null,
			length: 4,
			preview: "1280",
		},
	],
};

const byServer = new Map<string, RedisData>();
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function snapshot(serverId: string): RedisData {
	return byServer.get(serverId) ?? DEFAULT_DATA;
}

export function useRedisData(serverId: string): RedisData {
	return useSyncExternalStore(
		subscribe,
		() => snapshot(serverId),
		() => snapshot(serverId)
	);
}

function mutate(serverId: string, next: (data: RedisData) => RedisData) {
	byServer.set(serverId, next(snapshot(serverId)));
	emit();
}

export function createKey(serverId: string, key: RedisKey) {
	mutate(serverId, (data) => ({
		...data,
		keys: [...data.keys, { ...key, key: key.key.trim() }],
	}));
}

export function deleteKey(serverId: string, key: string) {
	mutate(serverId, (data) => ({
		...data,
		keys: data.keys.filter((entry) => entry.key !== key),
	}));
}
