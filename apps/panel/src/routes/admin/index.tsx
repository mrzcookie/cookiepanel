import {
	useSuspenseInfiniteQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, CreditCard } from "lucide-react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";
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
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import { allActivityQueryOptions } from "@/lib/activity-queries";
import { adminBillingQueryOptions } from "@/lib/admin-billing-queries";
import { adminUsersQueryOptions } from "@/lib/admin-users-queries";
import { billableNodeCount, monthlyTotalCents } from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { MONTHLY } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/")({
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(adminBillingQueryOptions()),
			context.queryClient.ensureQueryData(adminUsersQueryOptions()),
			context.queryClient.ensureInfiniteQueryData(allActivityQueryOptions()),
		]),
	component: AdminOverview,
});

const REVENUE_CONFIG = {
	revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

const GROWTH_CONFIG = {
	users: { label: "Users", color: "var(--chart-1)" },
	orgs: { label: "Organizations", color: "var(--chart-4)" },
} satisfies ChartConfig;

// Historical trend points are still illustrative: a monthly revenue/growth series
// needs time-series we don't record yet (the cache holds only current state). The
// tiles, table, and activity below are real; these two charts stay sampled until
// we persist history.
const REVENUE_DATA = MONTHLY.map((point) => ({
	month: point.month,
	revenue: Math.round(point.mrrCents / 100),
}));

function AdminOverview() {
	const billing = useSuspenseQuery(adminBillingQueryOptions()).data;
	const users = useSuspenseQuery(adminUsersQueryOptions()).data;
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
				<StatTile
					detail="accounts"
					label="Users"
					value={String(users.length)}
				/>
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

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Revenue</CardTitle>
						<CardDescription>
							Monthly recurring revenue, last 12 months (sample data).
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ChartContainer
							className="aspect-auto h-64 w-full"
							config={REVENUE_CONFIG}
						>
							<AreaChart
								data={REVENUE_DATA}
								margin={{ left: 4, right: 12, top: 8 }}
							>
								<CartesianGrid vertical={false} />
								<XAxis
									axisLine={false}
									dataKey="month"
									tickLine={false}
									tickMargin={8}
								/>
								<YAxis
									axisLine={false}
									tickFormatter={(value) => `$${value}`}
									tickLine={false}
									width={44}
								/>
								<ChartTooltip content={<ChartTooltipContent />} />
								<Area
									dataKey="revenue"
									fill="var(--color-revenue)"
									fillOpacity={0.15}
									isAnimationActive={false}
									stroke="var(--color-revenue)"
									strokeWidth={2}
									type="monotone"
								/>
							</AreaChart>
						</ChartContainer>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Growth</CardTitle>
						<CardDescription>
							Users and organizations over time (sample data).
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ChartContainer
							className="aspect-auto h-64 w-full"
							config={GROWTH_CONFIG}
						>
							<LineChart data={MONTHLY} margin={{ left: 4, right: 12, top: 8 }}>
								<CartesianGrid vertical={false} />
								<XAxis
									axisLine={false}
									dataKey="month"
									tickLine={false}
									tickMargin={8}
								/>
								<YAxis
									allowDecimals={false}
									axisLine={false}
									tickLine={false}
									width={28}
								/>
								<ChartTooltip content={<ChartTooltipContent />} />
								<Line
									dataKey="users"
									dot={false}
									isAnimationActive={false}
									stroke="var(--color-users)"
									strokeWidth={2}
									type="monotone"
								/>
								<Line
									dataKey="orgs"
									dot={false}
									isAnimationActive={false}
									stroke="var(--color-orgs)"
									strokeWidth={2}
									type="monotone"
								/>
								<ChartLegend content={<ChartLegendContent />} />
							</LineChart>
						</ChartContainer>
					</CardContent>
				</Card>
			</div>

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
