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
	deleteServer,
	reinstallServer,
	renameServer,
	updateServerLimits,
	useServer,
} from "@/lib/servers-store";
import type { ServerRow } from "@/lib/stubs";

const GiB = 1024 ** 3;

export const Route = createFileRoute("/_app/servers/$serverId/settings")({
	component: ServerSettingsTab,
});

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, Math.round(value)));
}

function ServerSettingsTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);

	if (!server) {
		return null;
	}

	return (
		<div className="space-y-6">
			<GeneralCard server={server} />
			<LimitsCard server={server} />
			<DetailsCard server={server} />
			<DangerZone server={server} />
		</div>
	);
}

function GeneralCard({ server }: { server: ServerRow }) {
	const [name, setName] = useState(server.name);

	useEffect(() => {
		setName(server.name);
	}, [server.name]);

	const changed = name.trim() !== server.name && name.trim() !== "";

	return (
		<Card>
			<CardHeader>
				<CardTitle>General</CardTitle>
				<CardDescription>What this server is called.</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						renameServer(server.id, name);
						toast.success("Server renamed.");
					}}
				>
					<div className="grid gap-2">
						<Label htmlFor="server-name">Name</Label>
						<Input
							id="server-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
					</div>
					<div className="flex justify-end">
						<Button disabled={!changed} type="submit">
							Save
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function LimitsCard({ server }: { server: ServerRow }) {
	const seedMemGb = Math.round(server.memLimitBytes / GiB);
	const seedDiskGb = Math.round(server.diskLimitBytes / GiB);

	const [cpu, setCpu] = useState(server.cpuLimitCores);
	const [memGb, setMemGb] = useState(seedMemGb);
	const [diskGb, setDiskGb] = useState(seedDiskGb);

	useEffect(() => {
		setCpu(server.cpuLimitCores);
		setMemGb(Math.round(server.memLimitBytes / GiB));
		setDiskGb(Math.round(server.diskLimitBytes / GiB));
	}, [server.cpuLimitCores, server.memLimitBytes, server.diskLimitBytes]);

	const changed =
		cpu !== server.cpuLimitCores ||
		memGb !== seedMemGb ||
		diskGb !== seedDiskGb;

	function save() {
		updateServerLimits(server.id, {
			cpuLimitCores: cpu,
			memLimitBytes: memGb * GiB,
			diskLimitBytes: diskGb * GiB,
		});
		toast.success("Resource limits updated.");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Resource limits</CardTitle>
				<CardDescription>
					Caps for this server. A restart applies new limits.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-5">
					<LimitField
						id="limit-cpu"
						label="CPU cores"
						max={64}
						onChange={(value) => setCpu(clamp(value, 1, 64))}
						unit="cores"
						value={cpu}
					/>
					<LimitField
						id="limit-mem"
						label="Memory"
						max={512}
						onChange={(value) => setMemGb(clamp(value, 1, 512))}
						unit="GB"
						value={memGb}
					/>
					<LimitField
						id="limit-disk"
						label="Disk"
						max={4096}
						onChange={(value) => setDiskGb(clamp(value, 1, 4096))}
						unit="GB"
						value={diskGb}
					/>
					<div className="flex justify-end border-t pt-4">
						<Button disabled={!changed} onClick={save}>
							Save
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function LimitField({
	id,
	label,
	max,
	onChange,
	unit,
	value,
}: {
	id: string;
	label: string;
	max: number;
	onChange: (value: number) => void;
	unit: string;
	value: number;
}) {
	return (
		<div className="grid gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<Label htmlFor={id}>{label}</Label>
				<span className="text-muted-foreground text-xs">{unit}</span>
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

function DetailsCard({ server }: { server: ServerRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Identifiers for this server.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow copyable label="Server ID" value={server.id} />
					<DetailRow label="Node" value={server.nodeName} />
					<DetailRow label="Template" value={server.templateName} />
					<DetailRow label="Created" value={server.createdAt} />
				</DetailList>
			</CardContent>
		</Card>
	);
}

function DangerZone({ server }: { server: ServerRow }) {
	const navigate = Route.useNavigate();
	const [reinstallOpen, setReinstallOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	function reinstall() {
		reinstallServer(server.id);
		setReinstallOpen(false);
		toast.success("Reinstalling the server…");
	}

	function remove() {
		deleteServer(server.id);
		toast.success(`Deleted “${server.name}”.`);
		navigate({ to: "/servers" });
	}

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-destructive">Danger zone</CardTitle>
				<CardDescription>
					Destructive actions for this server. These can't be undone.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="divide-y">
					<DangerRow
						action={
							<Button
								onClick={() => setReinstallOpen(true)}
								size="sm"
								variant="outline"
							>
								Reinstall
							</Button>
						}
						description="Re-run the template's install script. The data volume is kept, but installed files are replaced."
						title="Reinstall server"
					/>
					<DangerRow
						action={
							<Button
								onClick={() => setDeleteOpen(true)}
								size="sm"
								variant="destructive"
							>
								Delete
							</Button>
						}
						description="Permanently remove this server and its data from the node."
						title="Delete server"
					/>
				</div>
			</CardContent>

			<Dialog onOpenChange={setReinstallOpen} open={reinstallOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Reinstall this server?</DialogTitle>
						<DialogDescription>
							This re-runs the install script for “{server.name}”. Your data
							volume is kept, but files the installer manages are replaced. The
							server restarts when it's done.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button onClick={reinstall}>Reinstall</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this server?</DialogTitle>
						<DialogDescription>
							Permanently delete “{server.name}” and its data from{" "}
							{server.nodeName}. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button onClick={remove} variant="destructive">
							Delete server
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
