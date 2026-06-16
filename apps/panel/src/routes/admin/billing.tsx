import { createFileRoute, Link } from "@tanstack/react-router";
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
import {
	type BillingState,
	type BillingStatus,
	billableNodeCount,
	monthlyTotalCents,
} from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { billingStatus } from "@/lib/status";
import { EMPTY_STATE, useAllBilling } from "@/lib/stores/billing-store";
import { type Org, useOrgs } from "@/lib/stores/orgs-store";

export const Route = createFileRoute("/admin/billing")({
	component: AdminBilling,
});

type Account = { org: Org; billing: BillingState };

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
	const orgs = useOrgs();
	const billing = useAllBilling();

	const accounts: Account[] = orgs
		.map((org) => ({ org, billing: billing[org.id] ?? EMPTY_STATE }))
		.sort(
			(a, b) =>
				STATUS_RANK[a.billing.status] - STATUS_RANK[b.billing.status] ||
				monthlyTotalCents(b.billing) - monthlyTotalCents(a.billing)
		);

	const mrrCents = accounts.reduce(
		(sum, { billing: b }) => sum + monthlyTotalCents(b),
		0
	);
	const billableNodes = accounts.reduce(
		(sum, { billing: b }) => sum + billableNodeCount(b),
		0
	);
	const activeCount = accounts.filter(
		({ billing: b }) => b.status === "active"
	).length;
	const trialingCount = accounts.filter(
		({ billing: b }) => b.status === "trialing"
	).length;
	const pastDue = accounts.filter(({ billing: b }) => b.status === "past_due");
	const pastDueCents = pastDue.reduce(
		(sum, { billing: b }) => sum + monthlyTotalCents(b),
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
							{accounts.map(({ org, billing: b }) => (
								<TableRow key={org.id}>
									<TableCell>
										<Link
											className="font-medium hover:underline"
											params={{ orgId: org.id }}
											to="/admin/orgs/$orgId"
										>
											{org.name}
										</Link>
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{b.nodeCount === 0 ? "—" : b.nodeCount}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatMoney(monthlyTotalCents(b))}
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{nextDate(b)}
									</TableCell>
									<TableCell className="text-right">
										<StatusIndicator status={billingStatus(b.status)} />
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
