import { createFileRoute } from "@tanstack/react-router";
import { Network, ShieldOff } from "lucide-react";
import { CardStat, EntityCard, EntityIdentity } from "@/components/entity-card";
import { ListPage } from "@/components/list-page";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { pluralize } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { NETWORKS, type NetworkRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/networks")({
	component: Networks,
});

function Networks() {
	const [view, setView] = useListView("networks");

	return (
		<ListPage
			createLabel="Create network"
			description="Docker networks across your fleet — how servers reach each other and the outside world."
			emptyDescription="Networks group servers on a node and control their connectivity. Connect a node to get started."
			emptyTitle="No networks yet"
			filter={(network, q) =>
				network.name.toLowerCase().includes(q) ||
				network.nodeName.toLowerCase().includes(q) ||
				network.driver.toLowerCase().includes(q)
			}
			icon={Network}
			items={NETWORKS}
			noun="network"
			onViewChange={setView}
			renderCard={(network) => (
				<NetworkCard key={network.id} network={network} />
			)}
			renderTable={(networks) => <NetworksTable networks={networks} />}
			title="Networks"
			view={view}
		/>
	);
}

function IsolatedBadge() {
	return (
		<Badge variant="secondary">
			<ShieldOff />
			Isolated
		</Badge>
	);
}

function serversLabel(count: number) {
	return count === 0 ? "No servers" : pluralize(count, "server");
}

function NetworkCard({ network }: { network: NetworkRow }) {
	return (
		<EntityCard
			action={network.internal ? <IsolatedBadge /> : null}
			footer={<span>{serversLabel(network.serverCount)}</span>}
			icon={Network}
			subtitle={`${network.driver} · ${network.nodeName}`}
			title={network.name}
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
								title={network.name}
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
							{network.serverCount === 0 ? "—" : network.serverCount}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
