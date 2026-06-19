import { queryOptions } from "@tanstack/react-query";
import {
	listAdminUserAccounts,
	listAdminUserSessions,
	listAdminUsers,
} from "@/server/admin/users";

// Query factories for the /admin user panel: pair a query key with a server-fn
// call, so a route loader can preload (ensureQueryData) and the component reads
// the warm cache with useSuspenseQuery. See .claude/rules/panel.md. All feeds are
// admin-gated server-side (`requirePlatformAdmin`), so the keys carry no scope. The editor
// reads the selected row straight from the list (it carries the full
// AdminUserRow); the linked-logins and sessions panels each need a per-user query.

/** Every platform user (admin list). Newest first; filtered client-side. */
export function adminUsersQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "users"] as const,
		queryFn: () => listAdminUsers(),
	});
}

/** A user's linked social logins, for the editor's connections panel. Keyed under
 * the user-list prefix so a list invalidation refreshes it too. */
export function adminUserAccountsQueryOptions(userId: string) {
	return queryOptions({
		queryKey: ["admin", "users", userId, "accounts"] as const,
		queryFn: () => listAdminUserAccounts({ data: { userId } }),
	});
}

/** A user's active sessions, for the editor's sessions panel. Keyed under the
 * user-list prefix so a list invalidation refreshes it too. */
export function adminUserSessionsQueryOptions(userId: string) {
	return queryOptions({
		queryKey: ["admin", "users", userId, "sessions"] as const,
		queryFn: () => listAdminUserSessions({ data: { userId } }),
	});
}
