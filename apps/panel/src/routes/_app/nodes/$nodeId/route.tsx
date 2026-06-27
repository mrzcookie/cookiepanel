import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { RouteTabs, routeTabClassName } from "@/components/shared/route-tabs";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NodeRow } from "@/lib/domain/nodes";
import {
	nodeQueryOptions,
	nodesListQueryOptions,
	useNode,
} from "@/lib/node-queries";
import { nodeStatus } from "@/lib/status";

export const Route = createFileRoute("/_app/nodes/$nodeId")({
	// Warm the per-node query for the tabs below. A missing / cross-org id throws
	// a generic not-found; swallow it so the component renders its own screen
	// instead of bubbling to the router error boundary.
	loader: async ({ context, params }) => {
		const qc = context.queryClient;
		// Seed the per-node detail cache from the warm fleet list (if any) so a
		// list → detail navigation paints instantly instead of blocking on a fresh
		// getNode; the query's own poll reconciles live status moments later. A
		// direct hit (no list cache) just fetches as before.
		const detailKey = nodeQueryOptions(params.nodeId).queryKey;
		if (qc.getQueryData(detailKey) === undefined) {
			const fromList = qc
				.getQueryData(nodesListQueryOptions().queryKey)
				?.find((n) => n.id === params.nodeId);
			if (fromList) {
				qc.setQueryData(detailKey, fromList);
			}
		}
		try {
			await qc.ensureQueryData(nodeQueryOptions(params.nodeId));
		} catch {
			// Not found — handled in the component.
		}
	},
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
			<div className="space-y-4">
				<PageHeader
					back={{ label: "Nodes", to: "/nodes" }}
					border={false}
					description={
						<span className="font-mono">{`${node.fqdn}:${node.daemonPort}`}</span>
					}
					title={
						<span className="flex items-center gap-2.5">
							{node.name}
							<StatusIndicator
								live={node.status === "pending"}
								status={nodeStatus(node.status)}
							/>
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
