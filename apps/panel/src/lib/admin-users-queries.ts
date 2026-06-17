import { queryOptions } from "@tanstack/react-query";
import { getAdminUser, listAdminUsers } from "@/server/users";

// Query factories for the /admin user panel: pair a query key with a server-fn
// call, so a route loader can preload (ensureQueryData) and the component reads
// the warm cache with useSuspenseQuery. See .claude/rules/panel.md. Both feeds
// are admin-gated server-side (`requireAdmin`), so the keys carry no scope.

/** Every platform user (admin list). Newest first; filtered client-side. */
export function adminUsersQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "users"] as const,
		queryFn: () => listAdminUsers(),
	});
}

/** One platform user, for the detail/edit page. */
export function adminUserQueryOptions(userId: string) {
	return queryOptions({
		queryKey: ["admin", "users", userId] as const,
		queryFn: () => getAdminUser({ data: { userId } }),
	});
}
