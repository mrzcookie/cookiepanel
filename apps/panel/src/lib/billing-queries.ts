import { queryOptions } from "@tanstack/react-query";
import { getBilling } from "@/server/billing";

// Query factory for the active org's billing snapshot: pair a key with the
// org-scoped `getBilling` server fn, so a route loader can preload
// (ensureQueryData) and components read the warm cache (useSuspenseQuery). See
// .claude/rules/panel.md.

/**
 * The active organization's billing state. `getBilling` is org-scoped
 * server-side (`requireOrg`), so the key carries no org id — switching orgs
 * resets the query cache, which re-runs this against the new active org.
 *
 * Checkout/portal happen on Polar's hosted pages and reconcile back via webhook,
 * so the user returns to this tab to a freshly-changed state — refetch on focus
 * to pick it up without a manual reload.
 */
export function billingQueryOptions() {
	return queryOptions({
		queryKey: ["billing", "org"] as const,
		queryFn: () => getBilling(),
		refetchOnWindowFocus: true,
	});
}
