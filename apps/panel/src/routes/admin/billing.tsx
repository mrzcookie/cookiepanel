import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { StatTile } from "@/components/admin/stat-tile";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { adminBillingQueryOptions } from "@/lib/admin-billing-queries";
import {
	type BillingState,
	type BillingStatus,
	billableNodeCount,
	monthlyTotalCents,
} from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { billingStatus } from "@/lib/status";

export const Route = createFileRoute("/admin/billing")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminBillingQueryOptions()),
	component: AdminBilling,
});

// Attention first: surface the orgs that need action (past due, then trials)
// above the healthy ones, and "no plan" last.
const STATUS_RANK: Record<BillingStatus, number> = {
	past_due: 0,
	trialing: 1,
	active: 2,
	canceled: 3,
	none: 4,
};

/** The next dated event for an account — the date its current state resolves. */
function nextDate(billing: BillingState): string {
	switch (billing.status) {
		case "active":
		case "canceled":
			return billing.currentPeriodEnd ?? "—";
		case "trialing":
			return billing.trialEndsAt ?? "—";
		case "past_due":
			return billing.graceEndsAt ?? "—";
		default:
			return "—";
	}
}

function AdminBilling() {
	const rows = useSuspenseQuery(adminBillingQueryOptions()).data;

	const accounts = [...rows].sort(
		(a, b) =>
			STATUS_RANK[a.billing.status] - STATUS_RANK[b.billing.status] ||
			monthlyTotalCents(b.billing) - monthlyTotalCents(a.billing)
	);

	const mrrCents = accounts.reduce(
		(sum, { billing }) => sum + monthlyTotalCents(billing),
		0
	);
	const billableNodes = accounts.reduce(
		(sum, { billing }) => sum + billableNodeCount(billing),
		0
	);
	const activeCount = accounts.filter(
		({ billing }) => billing.status === "active"
	).length;
	const trialingCount = accounts.filter(
		({ billing }) => billing.status === "trialing"
	).length;
	const pastDue = accounts.filter(
		({ billing }) => billing.status === "past_due"
	);
	const pastDueCents = pastDue.reduce(
		(sum, { billing }) => sum + monthlyTotalCents(billing),
		0
	);

	return (
		<>
			<PageHeader
				description="Revenue and subscriptions across every organization — per-node plans, trials, and past-due accounts."
				eyebrow="revenue"
				title="Billing"
			/>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatTile
					detail={`${pluralize(billableNodes, "node")} billed`}
					label="MRR"
					value={formatMoney(mrrCents)}
				/>
				<StatTile
					detail="paying organizations"
					label="Active"
					value={String(activeCount)}
				/>
				<StatTile
					detail="in the free-node grant"
					label="Trials"
					value={String(trialingCount)}
				/>
				<StatTile
					detail={`${formatMoney(pastDueCents)} at risk`}
					label="Past due"
					tone={pastDue.length > 0 ? "warn" : undefined}
					value={String(pastDue.length)}
				/>
			</div>

			<Card>
				<CardContent>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Organization</TableHead>
								<TableHead className="text-right">Nodes</TableHead>
								<TableHead className="text-right">MRR</TableHead>
								<TableHead className="text-right">Next billing</TableHead>
								<TableHead className="text-right">Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{accounts.map(({ orgId, orgName, billing }) => (
								<TableRow key={orgId}>
									<TableCell>
										<span className="font-medium">{orgName}</span>
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{billing.nodeCount === 0 ? "—" : billing.nodeCount}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatMoney(monthlyTotalCents(billing))}
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{nextDate(billing)}
									</TableCell>
									<TableCell className="text-right">
										<StatusIndicator status={billingStatus(billing.status)} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</>
	);
}
