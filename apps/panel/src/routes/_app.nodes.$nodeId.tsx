import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ChevronLeft, HardDrive } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RouteTabs, routeTabClassName } from "@/components/route-tabs";
import { StatusIndicator } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNode } from "@/lib/nodes-store";
import { nodeStatus } from "@/lib/status";
import type { NodeRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/nodes/$nodeId")({
	component: NodeDetailLayout,
});

function NodeDetailLayout() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);

	if (!node) {
		return (
			<EmptyState
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/nodes">Back to nodes</Link>
					</Button>
				}
				description="It may have been removed, or you followed an old link."
				icon={HardDrive}
				title="Node not found"
			/>
		);
	}

	return <NodeChrome node={node} />;
}

function NodeChrome({ node }: { node: NodeRow }) {
	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
				to="/nodes"
			>
				<ChevronLeft className="size-4" />
				Nodes
			</Link>

			<div className="space-y-4">
				<PageHeader
					border={false}
					description={`${node.fqdn}:${node.daemonPort}`}
					title={
						<span className="flex items-center gap-2.5">
							{node.name}
							<StatusIndicator status={nodeStatus(node.status)} />
							{node.updateAvailable ? (
								<Badge variant="secondary">Update</Badge>
							) : null}
						</span>
					}
				/>
				<RouteTabs label="Node sections">
					<Link
						activeOptions={{ exact: true }}
						className={routeTabClassName}
						params={{ nodeId: node.id }}
						to="/nodes/$nodeId"
					>
						Overview
					</Link>
					<Link
						className={routeTabClassName}
						params={{ nodeId: node.id }}
						to="/nodes/$nodeId/networking"
					>
						Networking
					</Link>
					<Link
						className={routeTabClassName}
						params={{ nodeId: node.id }}
						to="/nodes/$nodeId/storage"
					>
						Storage
					</Link>
					<Link
						className={routeTabClassName}
						params={{ nodeId: node.id }}
						to="/nodes/$nodeId/settings"
					>
						Settings
					</Link>
				</RouteTabs>
			</div>

			<Outlet />
		</>
	);
}
