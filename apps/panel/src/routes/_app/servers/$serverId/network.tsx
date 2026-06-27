import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Network, Plug } from "lucide-react";
import { toast } from "sonner";
import { IsolatedBadge } from "@/components/networks/isolated-badge";
import { CopyButton } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	serverAllocationsQueryOptions,
	useServerAllocations,
} from "@/lib/allocation-queries";
import type { AllocationRow, NetworkRow } from "@/lib/domain/networks";
import type { ServerRow } from "@/lib/domain/servers";
import {
	invalidateNetworks,
	setServerNetwork,
	useNetworks,
} from "@/lib/networking-queries";
import { useServer } from "@/lib/server-queries";

export const Route = createFileRoute("/_app/servers/$serverId/network")({
	// Preload the (panel-owned) port allocations so the tab SSRs with them rather
	// than fetching after mount. Swallow errors — non-critical warm-up.
	loader: ({ context, params }) =>
		context.queryClient
			.ensureQueryData(serverAllocationsQueryOptions(params.serverId))
			.catch(() => {}),
	component: ServerNetworkTab,
});

function ServerNetworkTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);

	if (!server) {
		return null;
	}

	return (
		<div className="grid items-start gap-6 lg:grid-cols-2">
			<AllocationsCard server={server} />
			<NetworksCard server={server} />
		</div>
	);
}

function AllocationsCard({ server }: { server: ServerRow }) {
	const allocations = useServerAllocations(server.id);
	// The primary is the allocation on the server's published port.
	const primaryId = allocations.find((a) => a.port === server.port)?.id ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Ports</CardTitle>
				<CardDescription>
					Ports this server is bound to on {server.nodeName}. Reserve or release
					ports from the node's Networking tab.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{allocations.length === 0 ? (
					<EmptyState
						description="This server has no port allocations yet."
						icon={Plug}
						title="No ports"
					/>
				) : (
					<ul className="divide-y">
						{allocations.map((allocation) => (
							<AllocationRowItem
								allocation={allocation}
								isPrimary={allocation.id === primaryId}
								key={allocation.id}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function AllocationRowItem({
	allocation,
	isPrimary,
}: {
	allocation: AllocationRow;
	isPrimary: boolean;
}) {
	const address = `${allocation.ip}:${allocation.port}`;
	return (
		<li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
			<div className="flex min-w-0 items-center gap-2">
				<span className="truncate font-mono text-sm">{address}</span>
				<span className="text-muted-foreground text-xs uppercase">
					{allocation.protocol}
				</span>
				{isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
			</div>
			<CopyButton label={`port ${allocation.port}`} value={address} />
		</li>
	);
}

function NetworksCard({ server }: { server: ServerRow }) {
	const queryClient = useQueryClient();
	// Networks on this server's node it can join (the default `bridge` is implicit).
	const networks = useNetworks().filter(
		(n) => n.nodeId === server.nodeId && n.name !== "bridge"
	);

	async function attach(network: NetworkRow) {
		try {
			await setServerNetwork(network.id, server.id, "attach");
			await invalidateNetworks(queryClient);
			toast.success(`Attached to ${network.name}.`);
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Couldn't attach to the network."
			);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Networks</CardTitle>
				<CardDescription>
					Docker networks on {server.nodeName} this server can join to reach
					other servers.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{networks.length === 0 ? (
					<EmptyState
						description="Create a network on this node's Networking tab first."
						icon={Network}
						title="No networks on this node"
					/>
				) : (
					<ul className="divide-y">
						{networks.map((network) => (
							<li
								className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
								key={network.id}
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="truncate font-medium text-sm">
											{network.name}
										</span>
										{network.internal ? <IsolatedBadge /> : null}
									</div>
									<div className="truncate text-muted-foreground text-xs">
										{network.driver}
										{network.subnet ? ` · ${network.subnet}` : ""}
									</div>
								</div>
								<Button
									onClick={() => attach(network)}
									size="sm"
									variant="ghost"
								>
									Attach
								</Button>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
