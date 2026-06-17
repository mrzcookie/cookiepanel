import { infiniteQueryOptions } from "@tanstack/react-query";
import {
	listActivity,
	listAllActivity,
	listMyActivity,
} from "@/server/activity";

// Query factories for the activity feed: pair a query key with a server-fn call,
// so a route loader can preload (ensureInfiniteQueryData) and the component reads
// the warm cache with useSuspenseInfiniteQuery. See .claude/rules/panel.md.

/** Page size for the activity feeds (keyset-paginated by createdAt). */
const PAGE_SIZE = 50;

/** The signed-in user's own activity, newest first, with keyset "load more". */
export function myActivityQueryOptions() {
	return infiniteQueryOptions({
		queryKey: ["activity", "me"] as const,
		queryFn: ({ pageParam }) =>
			listMyActivity({ data: { limit: PAGE_SIZE, before: pageParam } }),
		initialPageParam: undefined as string | undefined,
		// A full page means there may be more; the next cursor is the oldest row's
		// timestamp (the repository's `before` is exclusive, so no overlap).
		getNextPageParam: (lastPage) =>
			lastPage.length < PAGE_SIZE ? undefined : lastPage.at(-1)?.createdAt,
	});
}

/**
 * The active organization's activity, newest first, with keyset "load more".
 * `listActivity` is org-scoped server-side (`requireOrg`), so the key has no org
 * id — switching orgs resets the query cache, which re-runs this against the new
 * active org.
 */
export function orgActivityQueryOptions() {
	return infiniteQueryOptions({
		queryKey: ["activity", "org"] as const,
		queryFn: ({ pageParam }) =>
			listActivity({ data: { limit: PAGE_SIZE, before: pageParam } }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) =>
			lastPage.length < PAGE_SIZE ? undefined : lastPage.at(-1)?.createdAt,
	});
}

/**
 * The whole platform's activity (every org + account-level events), newest first,
 * with keyset "load more". Backed by `listAllActivity`, which is admin-gated
 * server-side (`requireAdmin`); the key carries no scope because the feed is
 * unconditionally global — only the /admin console reads it.
 */
export function allActivityQueryOptions() {
	return infiniteQueryOptions({
		queryKey: ["activity", "all"] as const,
		queryFn: ({ pageParam }) =>
			listAllActivity({ data: { limit: PAGE_SIZE, before: pageParam } }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (lastPage) =>
			lastPage.length < PAGE_SIZE ? undefined : lastPage.at(-1)?.createdAt,
	});
}
