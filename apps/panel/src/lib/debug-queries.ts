import { queryOptions } from "@tanstack/react-query";
import { listDebugNodes } from "@/server/admin/debug";

// Query factory for the /admin/debug diagnostics surface: pair a key with the
// server-fn call so the route loader can preload (ensureQueryData) and the
// component reads the warm cache with useSuspenseQuery. See panel.md. The feed is
// admin-gated AND org-scoped server-side, so the key carries no scope.

/** The active org's fleet, with per-node connectivity/cert/heartbeat health. */
export function debugNodesQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "debug", "nodes"] as const,
		queryFn: () => listDebugNodes(),
		// Live connectivity: re-probe (while focused) so a box's reachability flip
		// shows without a manual refresh. Each refetch dials every box, so keep the
		// cadence gentle. A degraded box reads back as `{ ok: false }`, not an
		// error, so no retry.
		refetchInterval: 20_000,
		retry: false,
	});
}
