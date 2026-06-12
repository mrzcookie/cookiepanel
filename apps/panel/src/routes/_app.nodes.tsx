import { createFileRoute } from "@tanstack/react-router";
import { HardDrive } from "lucide-react";
import {
	CardStat,
	EntityCard,
	EntityIdentity,
	UsageMeter,
} from "@/components/entity-card";
import { ListPage } from "@/components/list-page";
import { StatusIndicator } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { formatBytes } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { nodeStatus } from "@/lib/status";
import { NODES, type NodeRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/nodes")({
	component: Nodes,
});

function Nodes() {
	const [view, setView] = useListView("nodes");

	return (
		<ListPage
			createLabel="Connect node"
			description="The Linux boxes running your servers."
			emptyDescription="Connect a Linux box you own to start running servers on it."
			emptyTitle="No nodes yet"
			filter={(node, q) =>
				node.name.toLowerCase().includes(q) ||
				node.fqdn.toLowerCase().includes(q)
			}
			icon={HardDrive}
			items={NODES}
			noun="node"
			onViewChange={setView}
			renderCard={(node) => <NodeCard key={node.id} node={node} />}
			renderTable={(nodes) => <NodesTable nodes={nodes} />}
			title="Nodes"
			view={view}
		/>
	);
}

/** Whole-percent usage, or null when a side is unknown (offline / pending). */
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

function serversLabel(node: NodeRow) {
	if (node.serversTotal === null) {
		return "—";
	}
	const running = node.serversRunning ?? "—";
	return `${running} / ${node.serversTotal} running`;
}

function NodeCard({ node }: { node: NodeRow }) {
	const stressed = node.status === "unhealthy";
	const memPercent = percent(node.memUsedBytes, node.memTotalBytes);
	const diskPercent = percent(node.diskUsedBytes, node.diskTotalBytes);

	return (
		<EntityCard
			action={<StatusIndicator status={nodeStatus(node.status)} />}
			footer={
				<>
					<span className="flex min-w-0 items-center gap-2">
						{node.daemonVersion ? (
							<span className="truncate font-mono">
								cookied {node.daemonVersion}
							</span>
						) : null}
						{node.updateAvailable ? (
							<Badge variant="secondary">Update</Badge>
						) : null}
					</span>
					<span className="shrink-0">
						{node.lastHeartbeat ?? "Awaiting first heartbeat"}
					</span>
				</>
			}
			icon={HardDrive}
			subtitle={`${node.fqdn}:${node.daemonPort}`}
			subtitleMono
			title={node.name}
		>
			{node.status === "pending" ? (
				<p className="text-muted-foreground text-sm">
					Waiting for the daemon to report in.
				</p>
			) : (
				<div className="flex flex-col gap-2.5">
					<CardStat
						label="System"
						value={node.os ? `${node.os} · ${node.arch}` : "—"}
					/>
					<UsageMeter
						detail={node.cpuPercent === null ? "—" : `${node.cpuPercent}%`}
						label="CPU"
						stressed={stressed || (node.cpuPercent ?? 0) >= 90}
						value={node.cpuPercent}
					/>
					<UsageMeter
						detail={ratio(node.memUsedBytes, node.memTotalBytes)}
						label="Memory"
						stressed={stressed || (memPercent ?? 0) >= 90}
						value={memPercent}
					/>
					<UsageMeter
						detail={ratio(node.diskUsedBytes, node.diskTotalBytes)}
						label="Disk"
						stressed={stressed || (diskPercent ?? 0) >= 90}
						value={diskPercent}
					/>
					<CardStat label="Servers" value={serversLabel(node)} />
				</div>
			)}
		</EntityCard>
	);
}

function NodesTable({ nodes }: { nodes: NodeRow[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Node</TableHead>
					<TableHead>Address</TableHead>
					<TableHead className="text-right">CPU</TableHead>
					<TableHead className="text-right">Memory</TableHead>
					<TableHead className="text-right">Servers</TableHead>
					<TableHead className="text-right">Status</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{nodes.map((node) => (
					<TableRow key={node.id}>
						<TableCell>
							<EntityIdentity
								icon={HardDrive}
								subtitle={node.os ? `${node.os} · ${node.arch}` : undefined}
								title={node.name}
							/>
						</TableCell>
						<TableCell className="font-mono text-muted-foreground text-xs">
							{node.fqdn}:{node.daemonPort}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{node.cpuPercent === null ? "—" : `${node.cpuPercent}%`}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{ratio(node.memUsedBytes, node.memTotalBytes)}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{node.serversTotal === null
								? "—"
								: `${node.serversRunning ?? "—"} / ${node.serversTotal}`}
						</TableCell>
						<TableCell className="text-right">
							<StatusIndicator status={nodeStatus(node.status)} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
