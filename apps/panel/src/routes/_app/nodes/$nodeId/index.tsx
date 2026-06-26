import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import type { NodeRow } from "@/lib/domain/nodes";
import type { ServerRow } from "@/lib/domain/servers";
import { formatBytes } from "@/lib/format";
import {
	nodeHostQueryOptions,
	nodeStatsQueryOptions,
	useNode,
} from "@/lib/node-queries";
import { useServersForNode } from "@/lib/server-queries";
import { serverStatus } from "@/lib/status";
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

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

function NodeOverview() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);
	const servers = useServersForNode(nodeId);

	if (!node) {
		return null;
	}

	const pending = node.status === "pending";

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

// An honest point-in-time bar — the daemon reports a single current value, not a
// history, so we show the live percentage rather than a fabricated trend.
function UsageChart({ stressed, value }: { stressed: boolean; value: number }) {
	return (
		<div className="flex h-20 items-end rounded-lg bg-muted/40 p-3">
			<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-500",
						stressed ? "bg-destructive" : "bg-foreground/70"
					)}
					style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
				/>
			</div>
		</div>
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
	// Only dial a reachable box. An offline node's heartbeat is already stale, so
	// polling its daemon every few seconds would just pile up failed calls.
	const live = node.status === "online" || node.status === "unhealthy";
	const query = useQuery({ ...nodeStatsQueryOptions(node.id), enabled: live });
	const stats = query.data?.ok ? query.data.data : null;

	const stressed = node.status === "unhealthy";
	const cpuPercent = stats ? Math.round(stats.cpuPercent) : null;
	const memPercent = stats
		? percent(stats.memUsedBytes, stats.memTotalBytes)
		: null;
	const diskPercent = stats
		? percent(stats.diskUsedBytes, stats.diskTotalBytes)
		: null;

	let description: string;
	if (!live) {
		description = `This node is offline${node.lastHeartbeat ? ` · last heartbeat ${node.lastHeartbeat}` : ""}.`;
	} else if (query.isPending) {
		description = "Reading live usage from the node…";
	} else if (query.data && !query.data.ok) {
		description = "Couldn't reach the node right now.";
	} else {
		description = "Sampled live from the node.";
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Live usage</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-6 sm:grid-cols-3">
					<UsageStat
						detail={node.cpuCores === null ? "—" : `${node.cpuCores} cores`}
						label="CPU"
						stressed={stressed || (cpuPercent ?? 0) >= 90}
						value={cpuPercent}
					/>
					<UsageStat
						detail={
							stats ? ratio(stats.memUsedBytes, stats.memTotalBytes) : "—"
						}
						label="Memory"
						stressed={stressed || (memPercent ?? 0) >= 90}
						value={memPercent}
					/>
					<UsageStat
						detail={
							stats ? ratio(stats.diskUsedBytes, stats.diskTotalBytes) : "—"
						}
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
	const live = node.status === "online" || node.status === "unhealthy";
	const query = useQuery({ ...nodeHostQueryOptions(node.id), enabled: live });
	const host = query.data?.ok ? query.data.data : null;

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
					{host?.cpuModel ? (
						<DetailRow label="CPU" value={host.cpuModel} />
					) : null}
					{host?.kernel ? (
						<DetailRow label="Kernel" value={host.kernel} />
					) : null}
					{host && host.uptimeSeconds > 0 ? (
						<DetailRow
							label="Uptime"
							value={formatUptime(host.uptimeSeconds)}
						/>
					) : null}
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
				<CardDescription>The wings agent running on this node.</CardDescription>
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
										{server.eggName}
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
