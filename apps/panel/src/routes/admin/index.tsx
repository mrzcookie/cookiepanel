import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleCheck, CreditCard, HardDrive } from "lucide-react";
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
import { ActivityList } from "@/components/shared/activity-list";
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
import { billableNodeCount, monthlyTotalCents } from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { EMPTY_STATE, useAllBilling } from "@/lib/stores/billing-store";
import { useOrgs } from "@/lib/stores/orgs-store";
import {
	ADMIN_ACTIVITY,
	ADMIN_NODES,
	ADMIN_USERS,
	MONTHLY,
} from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/")({
	component: AdminOverview,
});

const REVENUE_CONFIG = {
	revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

const GROWTH_CONFIG = {
	users: { label: "Users", color: "var(--chart-1)" },
	orgs: { label: "Organizations", color: "var(--chart-4)" },
} satisfies ChartConfig;

const REVENUE_DATA = MONTHLY.map((point) => ({
	month: point.month,
	revenue: Math.round(point.mrrCents / 100),
}));

function AdminOverview() {
	const orgs = useOrgs();
	const billing = useAllBilling();
	const states = orgs.map((org) => billing[org.id] ?? EMPTY_STATE);

	const mrrCents = states.reduce(
		(sum, plan) => sum + monthlyTotalCents(plan),
		0
	);
	const billableNodes = states.reduce(
		(sum, plan) => sum + billableNodeCount(plan),
		0
	);
	const nodesOnline = ADMIN_NODES.filter(
		(node) => node.status === "online"
	).length;
	const pastDueOrgs = orgs.filter(
		(org) => (billing[org.id] ?? EMPTY_STATE).status === "past_due"
	);
	const problemNodes = ADMIN_NODES.filter((node) => node.status !== "online");

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
					value={String(orgs.length)}
				/>
				<StatTile
					detail="accounts"
					label="Users"
					value={String(ADMIN_USERS.length)}
				/>
				<StatTile
					detail="online"
					label="Nodes"
					value={`${nodesOnline} / ${ADMIN_NODES.length}`}
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
							Monthly recurring revenue, last 12 months.
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
							Users and organizations over time.
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
							Accounts and nodes that may need a look.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{pastDueOrgs.length === 0 && problemNodes.length === 0 ? (
							<div className="flex items-center gap-2 text-muted-foreground text-sm">
								<CircleCheck className="size-4 text-ok" />
								All clear — nothing needs attention.
							</div>
						) : (
							<ul className="divide-y">
								{pastDueOrgs.map((org) => (
									<li
										className="flex items-center gap-3 py-3 first:pt-0"
										key={org.id}
									>
										<CreditCard className="size-4 shrink-0 text-destructive" />
										<span className="flex-1 text-sm">
											<Link
												className="font-medium hover:underline"
												params={{ orgId: org.id }}
												to="/admin/orgs/$orgId"
											>
												{org.name}
											</Link>{" "}
											<span className="text-muted-foreground">is past due</span>
										</span>
									</li>
								))}
								{problemNodes.map((node) => (
									<li
										className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
										key={node.id}
									>
										<HardDrive className="size-4 shrink-0 text-muted-foreground" />
										<span className="flex-1 text-sm">
											<Link
												className="font-medium hover:underline"
												params={{ nodeId: node.id }}
												to="/admin/nodes/$nodeId"
											>
												{node.name}
											</Link>{" "}
											<span className="text-muted-foreground">
												is {node.status}
											</span>
										</span>
										<span className="shrink-0 text-muted-foreground text-xs">
											{node.orgName}
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
						<ActivityList items={ADMIN_ACTIVITY.slice(0, 5)} />
						<Button asChild size="sm" variant="outline">
							<Link to="/admin/activity">View all activity</Link>
						</Button>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
