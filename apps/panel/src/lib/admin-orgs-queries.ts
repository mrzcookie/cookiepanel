import { queryOptions } from "@tanstack/react-query";
import { getAdminOrgMembers, listAdminOrgs } from "@/server/admin/orgs";

// Query factories for the /admin orgs panel: pair a query key with a server-fn
// call, so a route loader can preload (ensureQueryData) and the component reads
// the warm cache with useSuspenseQuery. See .claude/rules/panel.md. Both feeds are
// admin-gated server-side (`requirePlatformAdmin`), so the keys carry no scope. The editor
// reads the selected row straight from the list (it carries the full AdminOrgRow);
// the members panel needs a per-org query.

/** Every platform organization (admin list). Newest first; filtered client-side. */
export function adminOrgsQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "orgs"] as const,
		queryFn: () => listAdminOrgs(),
	});
}

/** An org's members, for the editor's members panel. Keyed under the org-list
 * prefix so a list invalidation refreshes it too. */
export function adminOrgMembersQueryOptions(orgId: string) {
	return queryOptions({
		queryKey: ["admin", "orgs", orgId, "members"] as const,
		queryFn: () => getAdminOrgMembers({ data: { orgId } }),
	});
}
