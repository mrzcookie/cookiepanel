import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Database, HardDrive, Lock, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityIconChip, UsageBar } from "@/components/shared/entity-card";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { DriveRow } from "@/lib/domain/nodes";
import { formatBytes, pluralize } from "@/lib/format";
import {
	formatDrive,
	invalidateNodeDrives,
	mountDrive,
	setDataTarget,
	unmountDrive,
	useNode,
	useNodeDrives,
} from "@/lib/node-queries";

const FILESYSTEMS = ["ext4", "xfs", "btrfs"] as const;
type Filesystem = (typeof FILESYSTEMS)[number];

export const Route = createFileRoute("/_app/nodes/$nodeId/storage")({
	component: NodeStorage,
});

function percent(used: number | null, total: number) {
	if (used === null || total === 0) {
		return null;
	}
	return Math.round((used / total) * 100);
}

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function NodeStorage() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);
	const drivesRead = useNodeDrives(nodeId);

	if (!node) {
		return null;
	}

	if (node.status === "pending") {
		return (
			<EmptyState
				description="This node hasn't reported in. Disks appear once the daemon connects."
				icon={HardDrive}
				title="No storage reported yet"
			/>
		);
	}
	if (node.status === "offline") {
		return (
			<EmptyState
				description="Storage was last seen when this node was online. Reconnect the node to manage its disks."
				icon={HardDrive}
				title="Node is offline"
			/>
		);
	}
	if (!drivesRead) {
		return (
			<EmptyState
				description="Reading the disks attached to this node…"
				icon={HardDrive}
				title="Loading storage"
			/>
		);
	}
	if (!drivesRead.ok) {
		return (
			<EmptyState
				description={drivesRead.error}
				icon={HardDrive}
				title="Couldn't reach the node"
			/>
		);
	}

	const drives = drivesRead.data;
	if (drives.length === 0) {
		return (
			<EmptyState
				description="The daemon didn't report any disks for this node."
				icon={HardDrive}
				title="No disks reported"
			/>
		);
	}

	const dataTarget = drives.find((drive) => drive.isDataTarget);
	const totalBytes = drives.reduce((sum, drive) => sum + drive.sizeBytes, 0);
	const unhealthy = node.status === "unhealthy";

	return (
		<Card>
			<CardHeader>
				<CardTitle>Drives</CardTitle>
				<CardDescription>
					{dataTarget
						? `${pluralize(drives.length, "disk")} · ${formatBytes(totalBytes)} total. Server data lives on ${dataTarget.model}.`
						: `${pluralize(drives.length, "disk")} · ${formatBytes(totalBytes)} total. No dedicated data disk yet.`}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{drives.map((drive) => (
						<DriveRowItem
							drive={drive}
							key={drive.id}
							nodeId={nodeId}
							unhealthy={unhealthy}
						/>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function DriveBadge({ drive }: { drive: DriveRow }) {
	if (drive.system) {
		return (
			<Badge variant="secondary">
				<Lock />
				System
			</Badge>
		);
	}
	if (drive.filesystem === null) {
		return <Badge variant="secondary">Unformatted</Badge>;
	}
	if (drive.mountpoint === null) {
		return <Badge variant="secondary">Unmounted</Badge>;
	}
	if (drive.isDataTarget) {
		return (
			<Badge variant="secondary">
				<Database />
				Server data
			</Badge>
		);
	}
	return null;
}

function DriveRowItem({
	drive,
	nodeId,
	unhealthy,
}: {
	drive: DriveRow;
	nodeId: string;
	unhealthy: boolean;
}) {
	const usedPercent = percent(drive.usedBytes, drive.sizeBytes);

	return (
		<li className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
			<EntityIconChip icon={HardDrive} size="sm" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium text-sm">{drive.model}</span>
					<DriveBadge drive={drive} />
				</div>
				<div className="truncate font-mono text-muted-foreground text-xs">
					{drive.device} · {drive.filesystem ?? "unformatted"} ·{" "}
					{drive.mountpoint ?? "unmounted"}
				</div>
			</div>
			<div className="hidden w-44 shrink-0 sm:block">
				{drive.usedBytes === null || usedPercent === null ? (
					<div className="text-right text-muted-foreground text-sm tabular-nums">
						{formatBytes(drive.sizeBytes)}
					</div>
				) : (
					<div className="space-y-1.5">
						<div className="text-right text-muted-foreground text-xs tabular-nums">
							{formatBytes(drive.usedBytes)} / {formatBytes(drive.sizeBytes)}
						</div>
						<UsageBar
							stressed={usedPercent >= 90 || unhealthy}
							value={usedPercent}
						/>
					</div>
				)}
			</div>
			<DriveActions drive={drive} nodeId={nodeId} />
		</li>
	);
}

function DriveActions({ drive, nodeId }: { drive: DriveRow; nodeId: string }) {
	const queryClient = useQueryClient();
	const [formatOpen, setFormatOpen] = useState(false);
	const [mountOpen, setMountOpen] = useState(false);
	const [dataTargetOpen, setDataTargetOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	// The system disk is locked against every mutation (enforced server-side too).
	if (drive.system) {
		return null;
	}

	const formatted = drive.filesystem !== null;
	const mounted = drive.mountpoint !== null;

	async function unmount() {
		setBusy(true);
		const id = toast.loading(`Unmounting ${drive.device}…`);
		try {
			await unmountDrive(nodeId, drive.device);
			await invalidateNodeDrives(queryClient, nodeId);
			toast.success(`Unmounted ${drive.device}.`, { id });
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't unmount the disk."), { id });
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						className="text-muted-foreground"
						disabled={busy}
						size="icon"
						variant="ghost"
					>
						<MoreHorizontal />
						<span className="sr-only">Drive actions for {drive.model}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{formatted ? null : (
						<DropdownMenuItem onClick={() => setFormatOpen(true)}>
							Format &amp; mount…
						</DropdownMenuItem>
					)}
					{formatted && !mounted ? (
						<DropdownMenuItem onClick={() => setMountOpen(true)}>
							Mount…
						</DropdownMenuItem>
					) : null}
					{mounted && !drive.isDataTarget ? (
						<DropdownMenuItem onClick={() => setDataTargetOpen(true)}>
							Set as server data
						</DropdownMenuItem>
					) : null}
					{mounted && !drive.isDataTarget ? (
						<DropdownMenuItem onClick={unmount}>Unmount</DropdownMenuItem>
					) : null}
					{formatted ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={() => setFormatOpen(true)}>
								Reformat…
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<FormatDriveDialog
				drive={drive}
				nodeId={nodeId}
				onOpenChange={setFormatOpen}
				open={formatOpen}
			/>
			<MountDriveDialog
				drive={drive}
				nodeId={nodeId}
				onOpenChange={setMountOpen}
				open={mountOpen}
			/>
			<DataTargetDialog
				drive={drive}
				nodeId={nodeId}
				onOpenChange={setDataTargetOpen}
				open={dataTargetOpen}
			/>
		</>
	);
}

function FormatDriveDialog({
	drive,
	nodeId,
	onOpenChange,
	open,
}: {
	drive: DriveRow;
	nodeId: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [filesystem, setFilesystem] = useState<Filesystem>("ext4");
	const [mountpoint, setMountpoint] = useState(drive.mountpoint ?? "/data");
	const [busy, setBusy] = useState(false);

	// Re-seed from the drive each time the dialog opens (a cancelled edit
	// shouldn't linger on reopen — same reasoning as the rename dialog).
	useEffect(() => {
		if (open) {
			setFilesystem(isFilesystem(drive.filesystem) ? drive.filesystem : "ext4");
			setMountpoint(drive.mountpoint ?? "/data");
		}
	}, [open, drive.filesystem, drive.mountpoint]);

	async function submit() {
		setBusy(true);
		const id = toast.loading(`Formatting ${drive.device} as ${filesystem}…`);
		try {
			await formatDrive(nodeId, drive.device, filesystem, mountpoint.trim());
			await invalidateNodeDrives(queryClient, nodeId);
			toast.success(`Formatted ${drive.device} as ${filesystem}.`, { id });
			onOpenChange(false);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't format the disk."), { id });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Format {drive.device}?</DialogTitle>
						<DialogDescription>
							Formatting erases everything on {drive.model} ({drive.device}),
							then mounts the fresh disk.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4 py-4 sm:flex-row">
						<div className="grid gap-2">
							<Label htmlFor="fs">Filesystem</Label>
							<Select
								onValueChange={(value) => setFilesystem(value as Filesystem)}
								value={filesystem}
							>
								<SelectTrigger className="w-32" id="fs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FILESYSTEMS.map((option) => (
										<SelectItem key={option} value={option}>
											{option}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid flex-1 gap-2">
							<Label htmlFor="format-mount">Mount at</Label>
							<Input
								className="font-mono text-sm"
								id="format-mount"
								onChange={(event) => setMountpoint(event.target.value)}
								placeholder="/data"
								value={mountpoint}
							/>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							disabled={busy || mountpoint.trim() === ""}
							type="submit"
							variant="destructive"
						>
							Format disk
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function MountDriveDialog({
	drive,
	nodeId,
	onOpenChange,
	open,
}: {
	drive: DriveRow;
	nodeId: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [mountpoint, setMountpoint] = useState("/data");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setMountpoint("/data");
		}
	}, [open]);

	async function submit() {
		setBusy(true);
		const id = toast.loading(`Mounting ${drive.device}…`);
		try {
			await mountDrive(nodeId, drive.device, mountpoint.trim());
			await invalidateNodeDrives(queryClient, nodeId);
			toast.success(`Mounted ${drive.device} at ${mountpoint.trim()}.`, { id });
			onOpenChange(false);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't mount the disk."), { id });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Mount {drive.device}</DialogTitle>
						<DialogDescription>
							Choose where to mount {drive.model} on this node.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="mount-point">Mount at</Label>
						<Input
							className="font-mono text-sm"
							id="mount-point"
							onChange={(event) => setMountpoint(event.target.value)}
							placeholder="/data"
							value={mountpoint}
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || mountpoint.trim() === ""} type="submit">
							Mount
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Repointing Docker's data-root restarts the engine, so every running server on
// the node blips — an explicit confirm rather than a one-click dropdown action.
function DataTargetDialog({
	drive,
	nodeId,
	onOpenChange,
	open,
}: {
	drive: DriveRow;
	nodeId: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);

	async function submit() {
		setBusy(true);
		const id = toast.loading(`Pointing server data at ${drive.model}…`);
		try {
			await setDataTarget(nodeId, drive.device);
			await invalidateNodeDrives(queryClient, nodeId);
			toast.success(`Server data now lives on ${drive.model}.`, { id });
			onOpenChange(false);
		} catch (error) {
			toast.error(errorMessage(error, "Couldn't set the data drive."), { id });
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Store server data on {drive.model}?</DialogTitle>
					<DialogDescription>
						New servers will keep their data on {drive.device} (
						{drive.mountpoint}
						). This restarts Docker, so servers running on this node briefly go
						offline while it comes back.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button disabled={busy} onClick={submit}>
						Set as server data
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function isFilesystem(value: string | null): value is Filesystem {
	return value !== null && (FILESYSTEMS as readonly string[]).includes(value);
}
