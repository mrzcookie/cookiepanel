import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Network, ShieldOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CardStat, EntityCard, EntityIdentity } from "@/components/entity-card";
import { ListPage } from "@/components/list-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { createNetwork, useNetworks } from "@/lib/networks-store";
import { type NetworkDriver, type NetworkRow, NODES } from "@/lib/stubs";

export const Route = createFileRoute("/_app/networks/")({
	component: Networks,
});

const DRIVERS: NetworkDriver[] = ["bridge", "macvlan", "ipvlan"];

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
				description="Docker networks across your fleet — how servers reach each other and the outside world."
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
			<CreateNetworkDialog onOpenChange={setCreateOpen} open={createOpen} />
		</>
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

function CreateNetworkDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const form = useForm({
		defaultValues: {
			driver: "bridge" as NetworkDriver,
			gateway: "",
			internal: false,
			name: "",
			nodeId: "",
			subnet: "",
		},
		onSubmit: ({ value, formApi }) => {
			const node = NODES.find((candidate) => candidate.id === value.nodeId);
			if (!node) {
				return;
			}
			createNetwork({
				driver: value.driver,
				gateway: value.gateway.trim() || null,
				internal: value.internal,
				name: value.name.trim(),
				nodeId: node.id,
				nodeName: node.name,
				subnet: value.subnet.trim() || null,
			});
			toast.success(`Created “${value.name.trim()}”.`);
			onOpenChange(false);
			formApi.reset();
		},
	});

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					form.reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Create a network</DialogTitle>
						<DialogDescription>
							Add a Docker network on one of your nodes for servers to share.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<form.Field name="nodeId">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Node</Label>
									<Select
										onValueChange={field.handleChange}
										value={field.state.value}
									>
										<SelectTrigger className="w-full" id={field.name}>
											<SelectValue placeholder="Select a node" />
										</SelectTrigger>
										<SelectContent>
											{NODES.map((node) => (
												<SelectItem key={node.id} value={node.id}>
													{node.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Name</Label>
									<Input
										id={field.name}
										name={field.name}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder="game-lan"
										value={field.state.value}
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="driver">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Driver</Label>
									<Select
										onValueChange={(value) =>
											field.handleChange(value as NetworkDriver)
										}
										value={field.state.value}
									>
										<SelectTrigger className="w-full" id={field.name}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DRIVERS.map((driver) => (
												<SelectItem key={driver} value={driver}>
													{driver}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="subnet">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Subnet</Label>
										<Input
											className="font-mono text-xs"
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="172.20.0.0/16"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
							<form.Field name="gateway">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Gateway</Label>
										<Input
											className="font-mono text-xs"
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="172.20.0.1"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
						</div>
						<form.Field name="internal">
							{(field) => (
								<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
									<div className="space-y-0.5">
										<Label htmlFor={field.name}>Isolated network</Label>
										<p className="text-muted-foreground text-xs">
											Block outbound internet access.
										</p>
									</div>
									<Switch
										checked={field.state.value}
										id={field.name}
										onCheckedChange={field.handleChange}
									/>
								</div>
							)}
						</form.Field>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<form.Subscribe
							selector={(state) =>
								state.values.name.trim() !== "" && state.values.nodeId !== ""
							}
						>
							{(canCreate) => (
								<Button disabled={!canCreate} type="submit">
									Create network
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
