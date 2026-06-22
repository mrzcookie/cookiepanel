import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, YAxis } from "recharts";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { CardStat } from "@/components/shared/entity-card";
import { StatusIndicator } from "@/components/shared/status-indicator";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import type { NodeRow } from "@/lib/domain/nodes";
import type { ServerRow } from "@/lib/domain/servers";
import { formatBytes } from "@/lib/format";
import { useNode } from "@/lib/node-queries";
import { serverStatus } from "@/lib/status";
import { serversForNode } from "@/lib/stubs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/nodes/$nodeId/")({
	component: NodeOverview,
});

function percent(used: number | null, total: number | null) {
	if (used === null || total === null || total === 0) {
		return null;
	}
	return Math.round((used / total) * 100);
}

function ratio(used: number | null, total: number | null) {
	return used === null || total === null
		? "—"
		: `${formatBytes(used)} / ${formatBytes(total)}`;
}

function NodeOverview() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);

	if (!node) {
		return null;
	}

	const pending = node.status === "pending";
	const servers = serversForNode(node.id);

	return (
		<div className="space-y-6">
			{pending ? <PendingCard /> : <LiveUsageCard node={node} />}
			<ServersCard pending={pending} servers={servers} />
			{pending ? (
				<IdentityCard node={node} />
			) : (
				<div className="grid items-start gap-6 lg:grid-cols-2">
					<IdentityCard node={node} />
					<DaemonCard node={node} />
				</div>
			)}
		</div>
	);
}

// A deterministic recent-history trend ending at the current value. Visual stub
// only (the daemon reports a point-in-time value); no random so it stays stable.
function usageSeries(current: number) {
	const points = 20;
	return Array.from({ length: points }, (_, i) => {
		if (i === points - 1) {
			return { i, value: current };
		}
		const wave =
			Math.sin((i + current) / 2.3) * 7 + Math.sin((i + current) / 5.5) * 4;
		return { i, value: Math.round(Math.min(98, Math.max(2, current + wave))) };
	});
}

function UsageChart({ stressed, value }: { stressed: boolean; value: number }) {
	const config = {
		value: {
			label: "Usage",
			color: stressed ? "var(--destructive)" : "var(--foreground)",
		},
	} satisfies ChartConfig;
	return (
		<ChartContainer className="aspect-auto h-20 w-full" config={config}>
			<AreaChart
				data={usageSeries(value)}
				margin={{ bottom: 0, left: 0, right: 0, top: 2 }}
			>
				<YAxis domain={[0, 100]} hide />
				<Area
					dataKey="value"
					dot={false}
					fill="var(--color-value)"
					fillOpacity={0.12}
					isAnimationActive={false}
					stroke="var(--color-value)"
					strokeWidth={2}
					type="monotone"
				/>
			</AreaChart>
		</ChartContainer>
	);
}

function UsageStat({
	detail,
	label,
	stressed,
	value,
}: {
	detail: string;
	label: string;
	stressed: boolean;
	value: number | null;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-baseline justify-between gap-2">
				<span className="font-medium text-sm">{label}</span>
				<span className="text-muted-foreground text-xs tabular-nums">
					{detail}
				</span>
			</div>
			<div
				className={cn(
					"font-semibold text-2xl tabular-nums",
					stressed && "text-destructive"
				)}
			>
				{value === null ? "—" : `${value}%`}
			</div>
			{value === null ? (
				<div className="flex h-20 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground text-xs">
					No live data
				</div>
			) : (
				<UsageChart stressed={stressed} value={value} />
			)}
		</div>
	);
}

function LiveUsageCard({ node }: { node: NodeRow }) {
	const stressed = node.status === "unhealthy";
	const memPercent = percent(node.memUsedBytes, node.memTotalBytes);
	const diskPercent = percent(node.diskUsedBytes, node.diskTotalBytes);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Live usage</CardTitle>
				<CardDescription>
					{node.status === "offline"
						? `Last reported ${node.lastHeartbeat ?? "a while ago"}. These figures may be stale.`
						: `Reported ${node.lastHeartbeat ?? "just now"}.`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 sm:grid-cols-3">
					<UsageStat
						detail={node.cpuCores === null ? "—" : `${node.cpuCores} cores`}
						label="CPU"
						stressed={stressed || (node.cpuPercent ?? 0) >= 90}
						value={node.cpuPercent}
					/>
					<UsageStat
						detail={ratio(node.memUsedBytes, node.memTotalBytes)}
						label="Memory"
						stressed={stressed || (memPercent ?? 0) >= 90}
						value={memPercent}
					/>
					<UsageStat
						detail={ratio(node.diskUsedBytes, node.diskTotalBytes)}
						label="Disk"
						stressed={stressed || (diskPercent ?? 0) >= 90}
						value={diskPercent}
					/>
				</div>
				<div className="mt-6 border-t pt-4">
					<CardStat
						label="Servers running"
						value={
							node.serversTotal === null
								? "—"
								: `${node.serversRunning ?? "—"} / ${node.serversTotal}`
						}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function IdentityCard({ node }: { node: NodeRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Identity</CardTitle>
				<CardDescription>How the panel reaches this node.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow
						copyable
						label="Address"
						value={`${node.fqdn}:${node.daemonPort}`}
					/>
					<DetailRow
						copyable={Boolean(node.publicIp)}
						label="Public IP"
						value={node.publicIp ?? "—"}
					/>
					<DetailRow
						label="Operating system"
						value={node.os ? `${node.os} · ${node.arch}` : "—"}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}

function DaemonCard({ node }: { node: NodeRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Daemon</CardTitle>
				<CardDescription>
					The cookied agent running on this node.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<DetailList>
					<DetailRow label="Version" value={node.daemonVersion ?? "—"} />
					<DetailRow label="Last heartbeat" value={node.lastHeartbeat ?? "—"} />
				</DetailList>
				{node.updateAvailable ? (
					<p className="text-muted-foreground text-sm">
						A newer daemon version is available. Update from the Settings tab.
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function PendingCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Waiting for the daemon</CardTitle>
				<CardDescription>
					Run the connect command on this node to finish setup.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<p className="text-muted-foreground text-sm">
					Waiting for the daemon to report in. Once it does, this node's
					hardware and live usage appear here.
				</p>
			</CardContent>
		</Card>
	);
}

function ServersCard({
	pending,
	servers,
}: {
	pending: boolean;
	servers: ServerRow[];
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Servers</CardTitle>
				<CardDescription>Game servers running on this node.</CardDescription>
			</CardHeader>
			<CardContent>
				{servers.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{pending
							? "No servers yet. Deploy one once this node is online."
							: "No servers are running on this node yet."}
					</p>
				) : (
					<ul className="divide-y">
						{servers.map((server) => (
							<li
								className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
								key={server.id}
							>
								<div className="min-w-0">
									<div className="truncate font-medium text-sm">
										{server.name}
									</div>
									<div className="truncate text-muted-foreground text-xs">
										{server.templateName}
									</div>
								</div>
								<StatusIndicator status={serverStatus(server.state)} />
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
