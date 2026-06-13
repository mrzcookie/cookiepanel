import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/detail-list";
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
	removeNode,
	updateNode,
	updateNodeCaps,
	useNode,
} from "@/lib/nodes-store";
import type { NodeCaps, NodeRow } from "@/lib/stubs";

const GiB = 1024 ** 3;

export const Route = createFileRoute("/_app/nodes/$nodeId/settings")({
	component: NodeSettings,
});

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, Math.round(value)));
}

function NodeSettings() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);

	if (!node) {
		return null;
	}

	return (
		<div className="space-y-6">
			<GeneralCard node={node} />
			<CapacityCard node={node} />
			<DetailsCard node={node} />
			<DangerZone node={node} />
		</div>
	);
}

// The immutable facts unique to Settings: the Node ID and how the panel reaches
// this box. Read-only, mirroring the account page's "Details" card; sits just
// above the danger zone. Overview already shows address / IP / OS / daemon.
function DetailsCard({ node }: { node: NodeRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Identifiers for this node.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow copyable label="Node ID" value={node.id} />
					<DetailRow
						label="Connection"
						value={node.managed ? "Managed DNS" : "Operator-pointed"}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}

function GeneralCard({ node }: { node: NodeRow }) {
	const [name, setName] = useState(node.name);
	const [fqdn, setFqdn] = useState(node.fqdn);
	const [publicIp, setPublicIp] = useState(node.publicIp ?? "");

	useEffect(() => {
		setName(node.name);
		setFqdn(node.fqdn);
		setPublicIp(node.publicIp ?? "");
	}, [node.name, node.fqdn, node.publicIp]);

	const changed =
		name !== node.name ||
		fqdn !== node.fqdn ||
		publicIp !== (node.publicIp ?? "");
	const valid = name.trim() !== "" && fqdn.trim() !== "";

	function save() {
		updateNode(node.id, {
			name: name.trim(),
			fqdn: fqdn.trim(),
			publicIp: publicIp.trim() || null,
		});
		toast.success("Node details saved.");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>General</CardTitle>
				<CardDescription>
					This node's name and how the panel reaches it.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor="node-name">Name</Label>
						<Input
							id="node-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="node-fqdn">Address (FQDN)</Label>
						<Input
							className="font-mono text-sm"
							id="node-fqdn"
							onChange={(event) => setFqdn(event.target.value)}
							value={fqdn}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="node-ip">Public IP</Label>
						<Input
							className="font-mono text-sm"
							id="node-ip"
							onChange={(event) => setPublicIp(event.target.value)}
							placeholder="Not set"
							value={publicIp}
						/>
					</div>
					<div className="flex justify-end">
						<Button disabled={!(changed && valid)} type="submit">
							Save
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function CapacityCard({ node }: { node: NodeRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Allocatable capacity</CardTitle>
				<CardDescription>
					Set how much of this node's hardware your org can hand out to servers.
					Caps can't exceed what the node has.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{node.caps !== null &&
				node.cpuCores !== null &&
				node.memTotalBytes !== null &&
				node.diskTotalBytes !== null ? (
					<CapacityForm
						caps={node.caps}
						maxCpu={node.cpuCores}
						maxDiskBytes={node.diskTotalBytes}
						maxMemBytes={node.memTotalBytes}
						nodeId={node.id}
					/>
				) : (
					<p className="text-muted-foreground text-sm">
						We'll show allocatable limits once this node reports its hardware.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function CapacityForm({
	caps,
	maxCpu,
	maxDiskBytes,
	maxMemBytes,
	nodeId,
}: {
	caps: NodeCaps;
	maxCpu: number;
	maxDiskBytes: number;
	maxMemBytes: number;
	nodeId: string;
}) {
	const maxMemGb = Math.floor(maxMemBytes / GiB);
	const maxDiskGb = Math.floor(maxDiskBytes / GiB);
	const seedMemGb = Math.round(caps.memBytes / GiB);
	const seedDiskGb = Math.round(caps.diskBytes / GiB);

	const [cpu, setCpu] = useState(caps.cpuCores);
	const [memGb, setMemGb] = useState(seedMemGb);
	const [diskGb, setDiskGb] = useState(seedDiskGb);

	useEffect(() => {
		setCpu(caps.cpuCores);
		setMemGb(Math.round(caps.memBytes / GiB));
		setDiskGb(Math.round(caps.diskBytes / GiB));
	}, [caps.cpuCores, caps.memBytes, caps.diskBytes]);

	const changed =
		cpu !== caps.cpuCores || memGb !== seedMemGb || diskGb !== seedDiskGb;

	function save() {
		updateNodeCaps(nodeId, {
			cpuCores: cpu,
			memBytes: memGb * GiB,
			diskBytes: diskGb * GiB,
		});
		toast.success("Allocatable capacity updated.");
	}

	return (
		<div className="space-y-5">
			<CapField
				id="cap-cpu"
				label="CPU cores"
				limit={`of ${maxCpu} cores`}
				max={maxCpu}
				onChange={(value) => setCpu(clamp(value, 1, maxCpu))}
				value={cpu}
			/>
			<CapField
				id="cap-mem"
				label="Memory"
				limit={`of ${maxMemGb} GB`}
				max={maxMemGb}
				onChange={(value) => setMemGb(clamp(value, 1, maxMemGb))}
				value={memGb}
			/>
			<CapField
				id="cap-disk"
				label="Disk"
				limit={`of ${maxDiskGb} GB`}
				max={maxDiskGb}
				onChange={(value) => setDiskGb(clamp(value, 1, maxDiskGb))}
				value={diskGb}
			/>
			<div className="flex justify-end border-t pt-4">
				<Button disabled={!changed} onClick={save}>
					Save
				</Button>
			</div>
		</div>
	);
}

function CapField({
	id,
	label,
	limit,
	max,
	onChange,
	value,
}: {
	id: string;
	label: string;
	limit: string;
	max: number;
	onChange: (value: number) => void;
	value: number;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<Label htmlFor={id}>{label}</Label>
				<span className="text-muted-foreground text-xs">{limit}</span>
			</div>
			<Input
				className="w-32 tabular-nums"
				id={id}
				inputMode="numeric"
				max={max}
				min={1}
				onChange={(event) => onChange(Number(event.target.value))}
				step={1}
				type="number"
				value={value}
			/>
		</div>
	);
}

function DangerZone({ node }: { node: NodeRow }) {
	const navigate = Route.useNavigate();
	const [removeOpen, setRemoveOpen] = useState(false);
	const reachable = node.status === "online" || node.status === "unhealthy";

	function remove() {
		removeNode(node.id);
		toast.success(`Removed “${node.name}”.`);
		navigate({ to: "/nodes" });
	}

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-destructive">Danger zone</CardTitle>
				<CardDescription>
					Maintenance and removal for this node. Some actions need the node to
					be online.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{reachable ? null : (
					<p className="pb-2 text-muted-foreground text-sm">
						{node.status === "pending"
							? "This node hasn't connected yet, so maintenance actions are unavailable."
							: "This node is offline, so maintenance actions are unavailable."}
					</p>
				)}
				<div className="divide-y">
					{node.updateAvailable ? (
						<DangerRow
							action={
								<Button
									disabled={!reachable}
									onClick={() => toast.success("Updating the daemon…")}
									size="sm"
									variant="outline"
								>
									Update
								</Button>
							}
							description={`Install the latest daemon. cookied ${node.daemonVersion} is behind.`}
							title="Update daemon"
						/>
					) : null}
					<DangerRow
						action={
							<Button
								disabled={!reachable}
								onClick={() => toast.success("Restarting the daemon…")}
								size="sm"
								variant="outline"
							>
								Restart
							</Button>
						}
						description="Restart the node's agent. Your servers aren't affected."
						title="Restart daemon"
					/>
					<DangerRow
						action={
							<Button
								disabled={!reachable}
								onClick={() => toast.success("Rebooting the node…")}
								size="sm"
								variant="outline"
							>
								Reboot
							</Button>
						}
						description="Restart the whole node. Servers go offline until it's back."
						title="Reboot node"
					/>
					<DangerRow
						action={
							<Button
								disabled={!reachable}
								onClick={() => toast.success("Pruning unused data…")}
								size="sm"
								variant="outline"
							>
								Prune
							</Button>
						}
						description="Free disk by clearing cached data no server is using."
						title="Prune unused data"
					/>
					<DangerRow
						action={
							<Button
								onClick={() => setRemoveOpen(true)}
								size="sm"
								variant="destructive"
							>
								Remove
							</Button>
						}
						description="Disconnect this node from your org. Its servers and data stay on the node."
						title="Remove node"
					/>
				</div>
			</CardContent>

			<Dialog onOpenChange={setRemoveOpen} open={removeOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Remove this node?</DialogTitle>
						<DialogDescription>
							Remove “{node.name}” from your org. The panel stops managing it.
							Its servers and data stay on the node; you can connect it again
							later.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button onClick={remove} variant="destructive">
							Remove node
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}

function DangerRow({
	action,
	description,
	title,
}: {
	action: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<div className="font-medium text-sm">{title}</div>
				<div className="text-muted-foreground text-xs">{description}</div>
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	);
}
