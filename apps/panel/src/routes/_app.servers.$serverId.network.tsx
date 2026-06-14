import { createFileRoute, Link } from "@tanstack/react-router";
import { Network, Plug, Plus } from "lucide-react";
import { useEffect, useState } from "react";
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
import type {
	AllocationProtocol,
	AllocationRow,
	NetworkRow,
} from "@/lib/domain/networks";
import type { ServerRow } from "@/lib/domain/servers";
import {
	addAllocation,
	portInUse,
	releaseAllocation,
	useServerAllocations,
} from "@/lib/stores/allocations-store";
import { useServer } from "@/lib/stores/servers-store";
import { networksForServer } from "@/lib/stubs";

export const Route = createFileRoute("/_app/servers/$serverId/network")({
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
	const [addOpen, setAddOpen] = useState(false);
	// Exactly one row is the primary: the first allocation on the published port.
	// (A port can be bound for both tcp + udp, so match by id, not by port.)
	const primaryId = allocations.find((a) => a.port === server.port)?.id ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Ports</CardTitle>
				<CardDescription>
					Ports this server is bound to on {server.nodeName}. The firewall opens
					in lockstep when you add or release one.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{allocations.length === 0 ? (
					<EmptyState
						description="Add a port so players can reach this server."
						icon={Plug}
						title="No ports yet"
					/>
				) : (
					<ul className="divide-y">
						{allocations.map((allocation) => (
							<AllocationRowItem
								allocation={allocation}
								canRelease={allocation.id !== primaryId}
								isPrimary={allocation.id === primaryId}
								key={allocation.id}
							/>
						))}
					</ul>
				)}
				<div className="border-t pt-3">
					<Button onClick={() => setAddOpen(true)} size="sm" variant="outline">
						<Plus />
						Add port
					</Button>
				</div>
			</CardContent>

			<AddPortDialog onOpenChange={setAddOpen} open={addOpen} server={server} />
		</Card>
	);
}

function AllocationRowItem({
	allocation,
	canRelease,
	isPrimary,
}: {
	allocation: AllocationRow;
	canRelease: boolean;
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
			<div className="flex shrink-0 items-center gap-1">
				<CopyButton label={`port ${allocation.port}`} value={address} />
				{canRelease ? (
					<Button
						onClick={() => {
							releaseAllocation(allocation.id);
							toast.success(`Released port ${allocation.port}.`);
						}}
						size="sm"
						variant="ghost"
					>
						Release
					</Button>
				) : null}
			</div>
		</li>
	);
}

function AddPortDialog({
	onOpenChange,
	open,
	server,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	server: ServerRow;
}) {
	const [port, setPort] = useState("");
	const [protocol, setProtocol] = useState<AllocationProtocol>("tcp");
	const [ip, setIp] = useState("0.0.0.0");

	useEffect(() => {
		if (open) {
			setPort("");
			setProtocol("tcp");
			setIp("0.0.0.0");
		}
	}, [open]);

	const portNum = Number(port);
	const portValid =
		port.trim() !== "" &&
		Number.isInteger(portNum) &&
		portNum >= 1 &&
		portNum <= 65535;
	const duplicate =
		portValid && portInUse(server.nodeId, portNum, protocol)
			? `Port ${portNum}/${protocol} is already allocated on ${server.nodeName}.`
			: null;
	const error =
		port.trim() === ""
			? null
			: portValid
				? duplicate
				: "Enter a port between 1 and 65535.";
	const canSubmit = portValid && !duplicate && ip.trim() !== "";

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!canSubmit) {
							return;
						}
						addAllocation({
							nodeId: server.nodeId,
							serverId: server.id,
							serverName: server.name,
							ip: ip.trim(),
							port: portNum,
							protocol,
						});
						toast.success(`Allocated port ${portNum}/${protocol}.`);
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Add a port</DialogTitle>
						<DialogDescription>
							Allocate another port on {server.nodeName} to this server. The
							firewall opens it automatically.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start">
						<div className="grid gap-2">
							<Label htmlFor="alloc-port">Port</Label>
							<Input
								autoFocus
								className="w-28 tabular-nums"
								id="alloc-port"
								inputMode="numeric"
								max={65535}
								min={1}
								onChange={(event) => setPort(event.target.value)}
								placeholder="25566"
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
								<SelectTrigger className="w-24" id="alloc-protocol">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="tcp">TCP</SelectItem>
									<SelectItem value="udp">UDP</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid flex-1 gap-2">
							<Label htmlFor="alloc-ip">Bind address</Label>
							<Input
								className="font-mono text-sm"
								id="alloc-ip"
								onChange={(event) => setIp(event.target.value)}
								placeholder="0.0.0.0"
								value={ip}
							/>
						</div>
					</div>
					{error ? (
						<p className="-mt-2 pb-2 text-destructive text-xs">{error}</p>
					) : null}
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!canSubmit} type="submit">
							Add port
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NetworksCard({ server }: { server: ServerRow }) {
	const networks = networksForServer(server.id);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Networks</CardTitle>
				<CardDescription>
					Networks this server is attached to. Attach or detach from a network's
					page.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{networks.length === 0 ? (
					<EmptyState
						description="Attach this server from a network's page."
						icon={Network}
						title="Not on any networks"
					/>
				) : (
					<ul className="divide-y">
						{networks.map((network) => (
							<NetworkRowItem key={network.id} network={network} />
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function NetworkRowItem({ network }: { network: NetworkRow }) {
	return (
		<li className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<Link
						className="truncate font-medium text-sm hover:underline"
						params={{ networkId: network.id }}
						to="/networks/$networkId"
					>
						{network.name}
					</Link>
					{network.internal ? <IsolatedBadge /> : null}
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{network.driver}
					{network.subnet ? ` · ${network.subnet}` : ""}
				</div>
			</div>
		</li>
	);
}
