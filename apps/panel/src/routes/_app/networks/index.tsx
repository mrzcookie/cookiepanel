import { createFileRoute, Link } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { useState } from "react";
import { CreateNetworkDialog } from "@/components/networks/create-network-dialog";
import { IsolatedBadge } from "@/components/networks/isolated-badge";
import {
	CardStat,
	EntityCard,
	EntityIdentity,
} from "@/components/shared/entity-card";
import { ListPage } from "@/components/shared/list/list-page";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { NetworkRow } from "@/lib/domain/networks";
import { pluralize } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { useNetworks } from "@/lib/stores/networks-store";
import { NODES } from "@/lib/stubs";

export const Route = createFileRoute("/_app/networks/")({
	component: Networks,
});

function serversLabel(count: number) {
	return count === 0 ? "No servers" : pluralize(count, "server");
}

function Networks() {
	const [view, setView] = useListView("networks");
	const networks = useNetworks();
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<>
			<ListPage
				createLabel="Create network"
				description="Networks across your fleet: how servers reach each other and the outside world."
				eyebrow="networking"
				emptyDescription="Networks group servers on a node and control their connectivity. Connect a node to get started."
				emptyTitle="No networks yet"
				filter={(network, q) =>
					network.name.toLowerCase().includes(q) ||
					network.nodeName.toLowerCase().includes(q) ||
					network.driver.toLowerCase().includes(q)
				}
				icon={Network}
				items={networks}
				noun="network"
				onCreate={() => setCreateOpen(true)}
				onViewChange={setView}
				renderCard={(network) => (
					<NetworkCard key={network.id} network={network} />
				)}
				renderTable={(rows) => <NetworksTable networks={rows} />}
				title="Networks"
				view={view}
			/>
			<CreateNetworkDialog
				nodes={NODES}
				onOpenChange={setCreateOpen}
				open={createOpen}
			/>
		</>
	);
}

function NetworkLink({ network }: { network: NetworkRow }) {
	return (
		<Link
			className="hover:underline"
			params={{ networkId: network.id }}
			to="/networks/$networkId"
		>
			{network.name}
		</Link>
	);
}

function NetworkCard({ network }: { network: NetworkRow }) {
	return (
		<EntityCard
			action={network.internal ? <IsolatedBadge /> : null}
			footer={<span>{serversLabel(network.serverIds.length)}</span>}
			icon={Network}
			subtitle={`${network.driver} · ${network.nodeName}`}
			title={<NetworkLink network={network} />}
		>
			<div className="flex flex-col gap-2.5">
				<CardStat
					label="Subnet"
					mono={Boolean(network.subnet)}
					value={network.subnet ?? "Auto"}
				/>
				<CardStat
					label="Gateway"
					mono={Boolean(network.gateway)}
					value={network.gateway ?? "—"}
				/>
			</div>
		</EntityCard>
	);
}

function NetworksTable({ networks }: { networks: NetworkRow[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Network</TableHead>
					<TableHead>Node</TableHead>
					<TableHead>Driver</TableHead>
					<TableHead>Subnet</TableHead>
					<TableHead className="text-right">Servers</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{networks.map((network) => (
					<TableRow key={network.id}>
						<TableCell>
							<EntityIdentity
								badge={network.internal ? <IsolatedBadge /> : null}
								icon={Network}
								title={<NetworkLink network={network} />}
							/>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{network.nodeName}
						</TableCell>
						<TableCell className="text-muted-foreground">
							{network.driver}
						</TableCell>
						<TableCell className="font-mono text-muted-foreground text-xs">
							{network.subnet ?? <span className="font-sans">Auto</span>}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{network.serverIds.length === 0 ? "—" : network.serverIds.length}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
