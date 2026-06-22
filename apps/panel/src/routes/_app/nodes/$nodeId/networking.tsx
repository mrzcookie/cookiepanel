import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock, Network, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CreateNetworkDialog } from "@/components/networks/create-network-dialog";
import { IsolatedBadge } from "@/components/networks/isolated-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityIdentity } from "@/components/shared/entity-card";
import { RemoveButton } from "@/components/shared/remove-button";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import type {
	AllocationProtocol,
	AllocationRow,
	NetworkRow,
} from "@/lib/domain/networks";
import type { FirewallRow, NodeRow } from "@/lib/domain/nodes";
import { useNode } from "@/lib/node-queries";
import { useNetworks } from "@/lib/stores/networks-store";
import {
	addAllocation,
	addFirewallRule,
	releaseAllocation,
	removeFirewallRule,
	setFirewallActive,
	useAllocations,
	useFirewall,
} from "@/lib/stores/node-resources-store";

export const Route = createFileRoute("/_app/nodes/$nodeId/networking")({
	component: NodeNetworking,
});

const PROTOCOLS: AllocationProtocol[] = ["tcp", "udp"];

function NodeNetworking() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);
	const networks = useNetworks().filter((network) => network.nodeId === nodeId);
	const allocations = useAllocations(nodeId);
	const firewall = useFirewall(nodeId);

	if (!node) {
		return null;
	}

	if (node.status === "pending") {
		return (
			<EmptyState
				description="This node is still being set up. Networks, ports, and the firewall appear once its daemon reports in."
				icon={Network}
				title="Networking isn't available yet"
			/>
		);
	}

	return (
		<div className="space-y-6">
			{node.status === "offline" ? (
				<div className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
					This node is offline. The networking details below were last reported{" "}
					{node.lastHeartbeat ?? "a while ago"} and may be out of date.
				</div>
			) : null}
			<NetworksCard networks={networks} node={node} />
			<AllocationsCard allocations={allocations} node={node} />
			<FirewallCard firewall={firewall} node={node} />
		</div>
	);
}

function NetworksCard({
	networks,
	node,
}: {
	networks: NetworkRow[];
	node: NodeRow;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Networks</CardTitle>
				<CardDescription>
					Networks on {node.name}. Servers attach to a network to reach each
					other.
				</CardDescription>
				<CardAction>
					<Button onClick={() => setOpen(true)} size="sm">
						<Plus />
						Create network
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				{networks.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No networks on this node yet.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Network</TableHead>
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
											subtitle={network.driver}
											title={
												<Link
													className="hover:underline"
													params={{ networkId: network.id }}
													to="/networks/$networkId"
												>
													{network.name}
												</Link>
											}
										/>
									</TableCell>
									<TableCell className="font-mono text-muted-foreground text-xs">
										{network.subnet ?? <span className="font-sans">Auto</span>}
									</TableCell>
									<TableCell className="text-right text-muted-foreground tabular-nums">
										{network.serverIds.length === 0
											? "—"
											: network.serverIds.length}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
			<CreateNetworkDialog node={node} onOpenChange={setOpen} open={open} />
		</Card>
	);
}

function AllocationsCard({
	allocations,
	node,
}: {
	allocations: AllocationRow[];
	node: NodeRow;
}) {
	const [open, setOpen] = useState(false);

	function release(allocation: AllocationRow) {
		releaseAllocation(allocation.id);
		toast.success(`Released ${allocation.ip}:${allocation.port}.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Port allocations</CardTitle>
				<CardDescription>
					Ports reserved on {node.name}. Each server binds to one of these to be
					reachable.
				</CardDescription>
				<CardAction>
					<Button onClick={() => setOpen(true)} size="sm" variant="outline">
						<Plus />
						Add port
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				{allocations.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No ports reserved on this node yet.
					</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Binding</TableHead>
								<TableHead>Protocol</TableHead>
								<TableHead>Used by</TableHead>
								<TableHead className="w-0">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{allocations.map((allocation) => (
								<TableRow key={allocation.id}>
									<TableCell className="font-mono text-sm">
										{allocation.ip}:{allocation.port}
									</TableCell>
									<TableCell className="font-mono text-muted-foreground text-xs">
										{allocation.protocol.toUpperCase()}
									</TableCell>
									<TableCell>
										{allocation.serverName ? (
											<span className="text-sm">{allocation.serverName}</span>
										) : (
											<StatusIndicator
												status={{ label: "Free", tone: "muted" }}
											/>
										)}
									</TableCell>
									<TableCell>
										{allocation.serverId === null ? (
											<RemoveButton
												label={`Release ${allocation.ip}:${allocation.port}`}
												onClick={() => release(allocation)}
											/>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
			<AddAllocationDialog node={node} onOpenChange={setOpen} open={open} />
		</Card>
	);
}

function AddAllocationDialog({
	node,
	onOpenChange,
	open,
}: {
	node: NodeRow;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [ip, setIp] = useState("0.0.0.0");
	const [port, setPort] = useState("");
	const [protocol, setProtocol] = useState<AllocationProtocol>("tcp");

	const portNumber = Number(port);
	const valid =
		Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;

	function reset() {
		setIp("0.0.0.0");
		setPort("");
		setProtocol("tcp");
	}

	function submit() {
		const bind = `${ip.trim() || "0.0.0.0"}:${portNumber}`;
		const reserved = addAllocation(node.id, {
			ip: ip.trim() || "0.0.0.0",
			port: portNumber,
			protocol,
		});
		if (reserved) {
			toast.success(`Reserved ${bind}.`);
		} else {
			toast.info(`${bind} is already reserved.`);
		}
		onOpenChange(false);
		reset();
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Reserve a port</DialogTitle>
						<DialogDescription>
							Reserve a port on {node.name} for a server to bind to.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="alloc-ip">Bind address</Label>
							<Input
								className="font-mono text-sm"
								id="alloc-ip"
								onChange={(event) => setIp(event.target.value)}
								placeholder="0.0.0.0"
								value={ip}
							/>
							<p className="text-muted-foreground text-xs">
								Use 0.0.0.0 for all interfaces.
							</p>
						</div>
						<div className="flex flex-col gap-4 sm:flex-row">
							<div className="grid flex-1 gap-2">
								<Label htmlFor="alloc-port">Port</Label>
								<Input
									className="tabular-nums"
									id="alloc-port"
									inputMode="numeric"
									max={65535}
									min={1}
									onChange={(event) => setPort(event.target.value)}
									placeholder="25565"
									type="number"
									value={port}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="alloc-protocol">Protocol</Label>
								<Select
									onValueChange={(value) =>
										setProtocol(value as AllocationProtocol)
									}
									value={protocol}
								>
									<SelectTrigger className="w-28" id="alloc-protocol">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{PROTOCOLS.map((option) => (
											<SelectItem key={option} value={option}>
												{option.toUpperCase()}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid} type="submit">
							Reserve port
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function FirewallCard({
	firewall,
	node,
}: {
	firewall: FirewallRow | undefined;
	node: NodeRow;
}) {
	const [open, setOpen] = useState(false);
	const managed = firewall !== undefined && firewall.backend !== "none";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Firewall</CardTitle>
				<CardDescription>
					The host firewall on {node.name} and the ports it allows in.
				</CardDescription>
				{managed ? (
					<CardAction>
						<Button onClick={() => setOpen(true)} size="sm" variant="outline">
							<Plus />
							Add rule
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent className="space-y-4">
				{firewall ? (
					<FirewallBody daemonPort={node.daemonPort} firewall={firewall} />
				) : (
					<p className="text-muted-foreground text-sm">
						No firewall reported for this node yet.
					</p>
				)}
			</CardContent>
			{firewall ? (
				<AddFirewallRuleDialog node={node} onOpenChange={setOpen} open={open} />
			) : null}
		</Card>
	);
}

function FirewallBody({
	daemonPort,
	firewall,
}: {
	daemonPort: number;
	firewall: FirewallRow;
}) {
	const backendLabel =
		firewall.backend === "ufw"
			? "UFW"
			: firewall.backend === "iptables"
				? "iptables"
				: "None";

	function removeRule(port: number, protocol: AllocationProtocol) {
		removeFirewallRule(firewall.nodeId, port, protocol);
		toast.success(`Closed port ${port}/${protocol}.`);
	}

	return (
		<>
			<div className="divide-y">
				<div className="flex items-center justify-between gap-4 py-3 first:pt-0">
					<span className="text-muted-foreground text-sm">Backend</span>
					<span className="font-mono text-sm">{backendLabel}</span>
				</div>
				<div className="flex items-center justify-between gap-4 py-3 last:pb-0">
					<span className="text-muted-foreground text-sm">Active</span>
					{firewall.backend === "none" ? (
						<StatusIndicator status={{ label: "Inactive", tone: "muted" }} />
					) : (
						<Switch
							aria-label="Firewall active"
							checked={firewall.active}
							onCheckedChange={(active) => {
								setFirewallActive(firewall.nodeId, active);
								toast.success(
									active ? "Firewall enabled." : "Firewall disabled."
								);
							}}
						/>
					)}
				</div>
			</div>

			{firewall.backend === "none" ? (
				<p className="text-muted-foreground text-sm">
					No managed firewall on this node. CookiePanel isn't filtering inbound
					traffic here.
				</p>
			) : (
				<div className="space-y-2">
					<p className="font-medium text-sm">Allowed ports</p>
					<p className="text-muted-foreground text-xs">
						SSH (22) and the daemon port ({daemonPort}) are always allowed and
						can't be closed, so a change here can never lock you out of this
						node.
					</p>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Port</TableHead>
								<TableHead>Protocol</TableHead>
								<TableHead className="w-0">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{firewall.rules.map((rule) => {
								const locked = rule.port === 22 || rule.port === daemonPort;
								return (
									<TableRow key={`${rule.port}-${rule.protocol}`}>
										<TableCell>
											<span className="flex items-center gap-2">
												<span className="font-mono text-sm">{rule.port}</span>
												{locked ? (
													<Badge variant="secondary">
														<Lock />
														Protected
													</Badge>
												) : null}
											</span>
										</TableCell>
										<TableCell className="font-mono text-muted-foreground text-xs">
											{rule.protocol.toUpperCase()}
										</TableCell>
										<TableCell>
											{locked ? null : (
												<RemoveButton
													label={`Close port ${rule.port}`}
													onClick={() => removeRule(rule.port, rule.protocol)}
												/>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}

function AddFirewallRuleDialog({
	node,
	onOpenChange,
	open,
}: {
	node: NodeRow;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [port, setPort] = useState("");
	const [protocol, setProtocol] = useState<AllocationProtocol>("tcp");

	const portNumber = Number(port);
	const valid =
		Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;

	function submit() {
		const opened = addFirewallRule(node.id, { port: portNumber, protocol });
		if (opened) {
			toast.success(`Opened port ${portNumber}/${protocol}.`);
		} else {
			toast.info(`Port ${portNumber}/${protocol} is already open.`);
		}
		onOpenChange(false);
		setPort("");
		setProtocol("tcp");
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setPort("");
					setProtocol("tcp");
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Open a port</DialogTitle>
						<DialogDescription>
							Allow inbound traffic to a port on {node.name}.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4 py-4 sm:flex-row">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="fw-port">Port</Label>
							<Input
								className="tabular-nums"
								id="fw-port"
								inputMode="numeric"
								max={65535}
								min={1}
								onChange={(event) => setPort(event.target.value)}
								placeholder="25565"
								type="number"
								value={port}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="fw-protocol">Protocol</Label>
							<Select
								onValueChange={(value) =>
									setProtocol(value as AllocationProtocol)
								}
								value={protocol}
							>
								<SelectTrigger className="w-28" id="fw-protocol">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PROTOCOLS.map((option) => (
										<SelectItem key={option} value={option}>
											{option.toUpperCase()}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid} type="submit">
							Open port
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
