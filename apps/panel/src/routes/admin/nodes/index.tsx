import { createFileRoute, Link } from "@tanstack/react-router";
import { HardDrive } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { EntityIdentity } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { nodeStatus } from "@/lib/status";
import { ADMIN_NODES } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/nodes/")({
	component: AdminNodes,
});

function AdminNodes() {
	return (
		<>
			<PageHeader
				description="The whole fleet across every organization — status, owning org, and daemon health."
				eyebrow="fleet"
				title="Nodes"
			/>
			<AdminList
				emptyDescription="No nodes connected yet."
				emptyTitle="No nodes"
				filter={(node, q) =>
					node.name.toLowerCase().includes(q) ||
					node.fqdn.toLowerCase().includes(q) ||
					node.orgName.toLowerCase().includes(q)
				}
				head={
					<TableRow>
						<TableHead>Node</TableHead>
						<TableHead>Organization</TableHead>
						<TableHead className="text-right">CPU</TableHead>
						<TableHead className="text-right">Servers</TableHead>
						<TableHead className="text-right">Status</TableHead>
					</TableRow>
				}
				icon={HardDrive}
				items={ADMIN_NODES}
				row={(node) => (
					<TableRow key={node.id}>
						<TableCell>
							<EntityIdentity
								icon={HardDrive}
								subtitle={node.fqdn}
								subtitleMono
								title={
									<Link
										className="hover:underline"
										params={{ nodeId: node.id }}
										to="/admin/nodes/$nodeId"
									>
										{node.name}
									</Link>
								}
							/>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{node.orgName}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{node.cpuPercent === null ? "—" : `${node.cpuPercent}%`}
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
				)}
				searchPlaceholder="Search nodes…"
			/>
		</>
	);
}
