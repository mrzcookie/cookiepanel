import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { CardStat } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { AdminNode } from "@/lib/domain/admin";
import { formatBytes } from "@/lib/format";
import { nodeStatus } from "@/lib/status";
import { ADMIN_NODES } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/nodes/$nodeId")({
	component: AdminNodeDetail,
});

function ratio(used: number | null, total: number | null) {
	return used === null || total === null
		? "—"
		: `${formatBytes(used)} / ${formatBytes(total)}`;
}

function usageNote(node: AdminNode) {
	if (node.status === "pending") {
		return "Waiting for the daemon to report in.";
	}
	if (node.status === "offline") {
		return "Last reported figures — the node is offline.";
	}
	return "Live, as last reported by the daemon.";
}

function AdminNodeDetail() {
	const { nodeId } = Route.useParams();
	const node = ADMIN_NODES.find((candidate) => candidate.id === nodeId);

	if (!node) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/admin/nodes">Back to nodes</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Node not found"
				tone="muted"
			/>
		);
	}

	return <NodeView node={node} />;
}

function NodeView({ node }: { node: AdminNode }) {
	return (
		<>
			<PageHeader
				actions={<StatusIndicator status={nodeStatus(node.status)} />}
				back={{ label: "Nodes", to: "/admin/nodes" }}
				description={`${node.fqdn}:${node.daemonPort}`}
				title={node.name}
			/>

			<p className="text-muted-foreground text-sm">
				Owned by <span className="text-foreground">{node.orgName}</span>
			</p>

			<div className="grid items-start gap-6 lg:grid-cols-2">
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
								label="DNS"
								value={node.managed ? "Panel-managed" : "Operator-pointed"}
							/>
							<DetailRow
								label="Operating system"
								value={node.os ? `${node.os} · ${node.arch}` : "—"}
							/>
						</DetailList>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Daemon</CardTitle>
						<CardDescription>The cookied agent on this node.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<DetailList>
							<DetailRow label="Version" value={node.daemonVersion ?? "—"} />
							<DetailRow
								label="Last heartbeat"
								value={node.lastHeartbeat ?? "—"}
							/>
						</DetailList>
						{node.updateAvailable ? (
							<Badge variant="secondary">Update available</Badge>
						) : null}
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Hardware &amp; usage</CardTitle>
					<CardDescription>{usageNote(node)}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2.5">
					<CardStat
						label="CPU"
						value={
							node.cpuPercent === null
								? "—"
								: `${node.cpuPercent}% · ${node.cpuCores ?? "—"} cores`
						}
					/>
					<CardStat
						label="Memory"
						value={ratio(node.memUsedBytes, node.memTotalBytes)}
					/>
					<CardStat
						label="Disk"
						value={ratio(node.diskUsedBytes, node.diskTotalBytes)}
					/>
					<CardStat
						label="Servers"
						value={
							node.serversTotal === null
								? "—"
								: `${node.serversRunning ?? "—"} / ${node.serversTotal} running`
						}
					/>
				</CardContent>
			</Card>
		</>
	);
}
