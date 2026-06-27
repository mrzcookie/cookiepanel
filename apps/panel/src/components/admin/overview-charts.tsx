import {
	Area,
	AreaChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";
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
import { MONTHLY } from "@/lib/stubs/admin";

// The admin overview's revenue + growth charts, split into their own module so
// the route can lazy-load it and keep recharts (+ its d3 deps, the largest dep
// after Monaco/xterm) out of the admin route's synchronous chunk.
//
// The series are still illustrative: a real monthly revenue/growth trend needs
// time-series we don't record yet (the cache holds only current state), so these
// stay sampled until we persist history.

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

export default function OverviewCharts() {
	return (
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
	);
}
