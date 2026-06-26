import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	DangerRow,
	DangerRows,
	DangerZoneCard,
} from "@/components/shared/danger-zone";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
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
import type { NodeCaps, NodeRow } from "@/lib/domain/nodes";
import { formatBytes } from "@/lib/format";
import {
	invalidateNodes,
	pruneNode,
	rebootNode,
	removeNode,
	restartDaemon,
	updateDaemon,
	updateNode,
	updateNodeCaps,
	useNode,
} from "@/lib/node-queries";

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
	const queryClient = useQueryClient();
	const [name, setName] = useState(node.name);
	const [fqdn, setFqdn] = useState(node.fqdn);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setName(node.name);
		setFqdn(node.fqdn);
	}, [node.name, node.fqdn]);

	const changed = name !== node.name || fqdn !== node.fqdn;
	const valid = name.trim() !== "" && fqdn.trim() !== "";

	async function save() {
		setSaving(true);
		try {
			await updateNode(node.id, { name: name.trim(), fqdn: fqdn.trim() });
			await invalidateNodes(queryClient);
			toast.success("Node details saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't save the node."
			);
		} finally {
			setSaving(false);
		}
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
					<div className="flex justify-end">
						<Button disabled={saving || !(changed && valid)} type="submit">
							Save changes
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
	const queryClient = useQueryClient();
	const maxMemGb = Math.floor(maxMemBytes / GiB);
	const maxDiskGb = Math.floor(maxDiskBytes / GiB);
	const seedMemGb = Math.round(caps.memBytes / GiB);
	const seedDiskGb = Math.round(caps.diskBytes / GiB);

	const [cpu, setCpu] = useState(caps.cpuCores);
	const [memGb, setMemGb] = useState(seedMemGb);
	const [diskGb, setDiskGb] = useState(seedDiskGb);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setCpu(caps.cpuCores);
		setMemGb(Math.round(caps.memBytes / GiB));
		setDiskGb(Math.round(caps.diskBytes / GiB));
	}, [caps.cpuCores, caps.memBytes, caps.diskBytes]);

	const changed =
		cpu !== caps.cpuCores || memGb !== seedMemGb || diskGb !== seedDiskGb;

	async function save() {
		setSaving(true);
		try {
			await updateNodeCaps(nodeId, {
				cpuCores: cpu,
				memBytes: memGb * GiB,
				diskBytes: diskGb * GiB,
			});
			await invalidateNodes(queryClient);
			toast.success("Allocatable capacity updated.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update capacity."
			);
		} finally {
			setSaving(false);
		}
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
				<Button disabled={saving || !changed} onClick={save}>
					Save changes
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

type BusyAction = "update" | "restart" | "reboot" | "prune" | null;

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function DangerZone({ node }: { node: NodeRow }) {
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const [removeOpen, setRemoveOpen] = useState(false);
	const [rebootOpen, setRebootOpen] = useState(false);
	const [updateOpen, setUpdateOpen] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [busy, setBusy] = useState<BusyAction>(null);
	const reachable = node.status === "online" || node.status === "unhealthy";
	const disabled = !reachable || busy !== null;

	async function remove() {
		setRemoving(true);
		try {
			await removeNode(node.id);
			await invalidateNodes(queryClient);
			toast.success(`Removed “${node.name}”.`);
			navigate({ to: "/nodes" });
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't remove the node."));
			setRemoving(false);
		}
	}

	async function restart() {
		setBusy("restart");
		const id = toast.loading("Restarting the daemon…");
		try {
			await restartDaemon(node.id);
			toast.success("The daemon is restarting.", { id });
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't restart the daemon."), { id });
		} finally {
			setBusy(null);
		}
	}

	async function prune() {
		setBusy("prune");
		const id = toast.loading("Pruning unused data…");
		try {
			const res = await pruneNode(node.id);
			toast.success(
				res.spaceReclaimedBytes > 0
					? `Freed ${formatBytes(res.spaceReclaimedBytes)}.`
					: "Nothing to prune — already clean.",
				{ id }
			);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't prune the node."), { id });
		} finally {
			setBusy(null);
		}
	}

	async function reboot() {
		setBusy("reboot");
		const id = toast.loading("Rebooting the node…");
		try {
			await rebootNode(node.id);
			toast.success("The node is rebooting.", { id });
			setRebootOpen(false);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't reboot the node."), { id });
		} finally {
			setBusy(null);
		}
	}

	async function update() {
		setBusy("update");
		const id = toast.loading("Updating the daemon…");
		try {
			await updateDaemon(node.id);
			toast.success("The daemon updated and is restarting.", { id });
			setUpdateOpen(false);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't update the daemon."), { id });
		} finally {
			setBusy(null);
		}
	}

	return (
		<DangerZoneCard description="Maintenance and removal for this node. Some actions need the node to be online.">
			{reachable ? null : (
				<p className="pb-2 text-muted-foreground text-sm">
					{node.status === "pending"
						? "This node hasn't connected yet, so maintenance actions are unavailable."
						: "This node is offline, so maintenance actions are unavailable."}
				</p>
			)}
			<DangerRows>
				{node.updateAvailable ? (
					<DangerRow
						action={
							<Button
								disabled={disabled}
								onClick={() => setUpdateOpen(true)}
								size="sm"
								variant="outline"
							>
								Update
							</Button>
						}
						description={`Install the latest daemon. wings ${node.daemonVersion} is behind.`}
						title="Update daemon"
					/>
				) : null}
				<DangerRow
					action={
						<Button
							disabled={disabled}
							onClick={restart}
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
							disabled={disabled}
							onClick={() => setRebootOpen(true)}
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
							disabled={disabled}
							onClick={prune}
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
			</DangerRows>

			<Dialog onOpenChange={setUpdateOpen} open={updateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Update the daemon?</DialogTitle>
						<DialogDescription>
							Download the latest wings and replace the agent (wings{" "}
							{node.daemonVersion} is behind). The agent restarts to finish;
							your servers keep running.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy === "update"} onClick={update}>
							Update daemon
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setRebootOpen} open={rebootOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reboot this node?</DialogTitle>
						<DialogDescription>
							Restart the whole machine. Every server on “{node.name}” goes
							offline until it boots back up.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							disabled={busy === "reboot"}
							onClick={reboot}
							variant="destructive"
						>
							Reboot node
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

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
						<Button disabled={removing} onClick={remove} variant="destructive">
							Remove node
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</DangerZoneCard>
	);
}
