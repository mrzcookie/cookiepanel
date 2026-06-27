import {
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, CreditCard } from "lucide-react";
import { lazy, Suspense } from "react";
import { StatTile } from "@/components/admin/stat-tile";
import {
	ActivityList,
	toActivityItem,
} from "@/components/shared/activity-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { allActivityQueryOptions } from "@/lib/activity-queries";
import { adminBillingQueryOptions } from "@/lib/admin-billing-queries";
import { adminUsersCountQueryOptions } from "@/lib/admin-users-queries";
import { billableNodeCount, monthlyTotalCents } from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";

// recharts (+ d3) is heavy; the overview charts load as their own async chunk
// after paint rather than in this route's synchronous bundle.
const OverviewCharts = lazy(() => import("@/components/admin/overview-charts"));

export const Route = createFileRoute("/admin/")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(adminBillingQueryOptions()),
			context.queryClient.ensureQueryData(adminUsersCountQueryOptions()),
			context.queryClient.ensureInfiniteQueryData(allActivityQueryOptions()),
		]),
	component: AdminOverview,
});

function AdminOverview() {
	const billing = useSuspenseQuery(adminBillingQueryOptions()).data;
	const userCount = useSuspenseQuery(adminUsersCountQueryOptions()).data;
	const activity = useSuspenseInfiniteQuery(allActivityQueryOptions());

	const mrrCents = billing.reduce(
		(sum, row) => sum + monthlyTotalCents(row.billing),
		0
	);
	const billableNodes = billing.reduce(
		(sum, row) => sum + billableNodeCount(row.billing),
		0
	);
	const totalNodes = billing.reduce(
		(sum, row) => sum + row.billing.nodeCount,
		0
	);
	const pastDueOrgs = billing.filter(
		(row) => row.billing.status === "past_due"
	);
	const recent = activity.data.pages.flat().slice(0, 5).map(toActivityItem);

	return (
		<>
			<PageHeader
				description="Platform health across every organization."
				eyebrow="control room"
				title="Overview"
			/>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatTile
					detail="tenants"
					label="Organizations"
					value={String(billing.length)}
				/>
				<StatTile detail="accounts" label="Users" value={String(userCount)} />
				<StatTile
					detail="registered"
					label="Nodes"
					value={String(totalNodes)}
				/>
				<StatTile
					detail={`${pluralize(billableNodes, "node")} billed`}
					label="MRR"
					value={formatMoney(mrrCents)}
				/>
			</div>

			<Suspense fallback={<ChartsFallback />}>
				<OverviewCharts />
			</Suspense>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Needs attention</CardTitle>
						<CardDescription>
							Organizations that may need a look.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{pastDueOrgs.length === 0 ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<CircleCheck className="size-4 text-ok" />
								All clear — nothing needs attention.
							</div>
						) : (
							<ul className="divide-y">
								{pastDueOrgs.map((row) => (
									<li
										className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
										key={row.orgId}
									>
										<CreditCard className="size-4 shrink-0 text-destructive" />
										<span className="flex-1 text-sm">
											<span className="font-medium">{row.orgName}</span>{" "}
											<span className="text-muted-foreground">is past due</span>
										</span>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Recent activity</CardTitle>
						<CardDescription>
							The latest platform and tenant actions.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<ActivityList items={recent} />
						<Button asChild size="sm" variant="outline">
							<Link to="/admin/activity">View all activity</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</>
	);
}

function ChartsFallback() {
	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<div className="h-80 rounded-xl border bg-muted/20" />
			<div className="h-80 rounded-xl border bg-muted/20" />
		</div>
	);
}
