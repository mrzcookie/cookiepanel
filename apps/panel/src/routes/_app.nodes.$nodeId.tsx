import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { ErrorScreen } from "@/components/error-screen";
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
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/nodes">Back to nodes</Link>
				</Button>
			}
			className="min-h-[60vh]"
			code="404"
			description="That section doesn't exist. Pick a tab above, or head back."
			title="Page not found"
			tone="muted"
		/>
	),
});

function NodeDetailLayout() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);

	if (!node) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/nodes">Back to nodes</Link>
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

	return <NodeChrome node={node} />;
}

function NodeChrome({ node }: { node: NodeRow }) {
	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
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
