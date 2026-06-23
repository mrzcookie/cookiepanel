import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/layout/error-screen";
import { IsolatedBadge } from "@/components/networks/isolated-badge";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { NetworkRow } from "@/lib/domain/networks";
import {
	deleteNetwork,
	invalidateNetworks,
	networksListQueryOptions,
	useNetworks,
} from "@/lib/networking-queries";

export const Route = createFileRoute("/_app/networks/$networkId")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(networksListQueryOptions()),
	component: NetworkDetail,
});

function NetworkDetail() {
	const { networkId } = Route.useParams();
	const network = useNetworks().find((n) => n.id === networkId);

	if (!network) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/networks">Back to networks</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or its node is offline."
				title="Network not found"
				tone="muted"
			/>
		);
	}

	return <NetworkManage network={network} />;
}

function NetworkManage({ network }: { network: NetworkRow }) {
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	// The default `bridge` network can't be deleted.
	const deletable = network.name !== "bridge";

	async function remove() {
		try {
			await deleteNetwork(network.nodeId, network.id);
			await invalidateNetworks(queryClient);
			toast.success(`Deleted “${network.name}”.`);
			navigate({ to: "/networks" });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't delete the network."
			);
		}
	}

	return (
		<>
			<PageHeader
				actions={
					deletable ? (
						<Button onClick={remove} size="sm" variant="destructive">
							Delete
						</Button>
					) : null
				}
				back={{ label: "Networks", to: "/networks" }}
				description={`${network.driver} · ${network.nodeName}`}
				title={
					<span className="flex items-center gap-2">
						{network.name}
						{network.internal ? <IsolatedBadge /> : null}
					</span>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Configuration</CardTitle>
					<CardDescription>
						How this network is addressed on {network.nodeName}. Attach servers
						from a server's Network tab.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DetailList>
						<DetailRow label="Node" value={network.nodeName} />
						<DetailRow label="Driver" value={network.driver} />
						<DetailRow
							copyable={Boolean(network.subnet)}
							label="Subnet"
							value={network.subnet ?? "Auto"}
						/>
						<DetailRow
							copyable={Boolean(network.gateway)}
							label="Gateway"
							value={network.gateway ?? "—"}
						/>
					</DetailList>
				</CardContent>
			</Card>
		</>
	);
}
