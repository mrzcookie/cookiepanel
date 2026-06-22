import { queryOptions } from "@tanstack/react-query";
import { listAdminBilling } from "@/server/admin/billing";

// Query factory for the admin cross-org billing feed — one source for both the
// /admin overview (MRR, past-due, counts) and the /admin/billing table. See
// .claude/rules/panel.md.

export function adminBillingQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "billing"] as const,
		queryFn: () => listAdminBilling(),
		// Cached billing rows change only on Polar webhooks / node moves; keep it
		// warm so the overview and the billing table don't both refetch.
		staleTime: 30_000,
	});
}
