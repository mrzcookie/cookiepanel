import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { billingQueryOptions } from "@/lib/billing-queries";

// App-wide nudge: when the active org's last payment failed, surface it on every
// page (not just the billing tab) so it can't be missed — but quietly, and never
// blocking. Renders nothing in every other state. Uses a non-suspense query so it
// never blocks the app shell; the billing tab's loader keeps the cache warm.
export function PastDueBanner() {
	const { data: billing } = useQuery(billingQueryOptions());
	const { data: org } = authClient.useActiveOrganization();

	if (billing?.status !== "past_due") {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-danger-wash/40 px-4 py-3">
			<AlertTriangle className="size-4 shrink-0 text-destructive" />
			<p className="min-w-0 flex-1 text-sm">
				<span className="font-medium">
					Payment failed{org?.name ? ` for ${org.name}` : ""}.
				</span>{" "}
				Update your payment method
				{billing.graceEndsAt ? ` by ${billing.graceEndsAt}` : ""} to keep your
				nodes running.
			</p>
			<Button asChild size="sm">
				<Link to="/settings/billing">Update billing</Link>
			</Button>
		</div>
	);
}
