import { createFileRoute } from "@tanstack/react-router";
import { Database, HardDrive, Lock, MoreHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { EntityIconChip, UsageBar } from "@/components/entity-card";
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
import { formatBytes, pluralize } from "@/lib/format";
import {
	formatDrive,
	mountDrive,
	setDataTarget,
	unmountDrive,
	useDrives,
} from "@/lib/node-resources-store";
import { useNode } from "@/lib/nodes-store";
import type { DriveRow } from "@/lib/stubs";

const FILESYSTEMS = ["ext4", "xfs", "btrfs"];

export const Route = createFileRoute("/_app/nodes/$nodeId/storage")({
	component: NodeStorage,
});

function percent(used: number | null, total: number) {
	if (used === null || total === 0) {
		return null;
	}
	return Math.round((used / total) * 100);
}

function isSystemDrive(drive: DriveRow) {
	return drive.mountpoint === "/" || drive.mountpoint === "/boot";
}

function NodeStorage() {
	const { nodeId } = Route.useParams();
	const node = useNode(nodeId);
	const drives = useDrives(nodeId);

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
	if (isSystemDrive(drive)) {
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
	const [formatOpen, setFormatOpen] = useState(false);
	const [mountOpen, setMountOpen] = useState(false);

	if (isSystemDrive(drive)) {
		return null;
	}

	const formatted = drive.filesystem !== null;
	const mounted = drive.mountpoint !== null;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button className="text-muted-foreground" size="icon" variant="ghost">
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
						<DropdownMenuItem
							onClick={() => {
								setDataTarget(nodeId, drive.id);
								toast.success(`Server data set to ${drive.model}.`);
							}}
						>
							Set as server data
						</DropdownMenuItem>
					) : null}
					{mounted && !drive.isDataTarget ? (
						<DropdownMenuItem
							onClick={() => {
								unmountDrive(drive.id);
								toast.success(`Unmounted ${drive.device}.`);
							}}
						>
							Unmount
						</DropdownMenuItem>
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
				onOpenChange={setFormatOpen}
				open={formatOpen}
			/>
			<MountDriveDialog
				drive={drive}
				onOpenChange={setMountOpen}
				open={mountOpen}
			/>
		</>
	);
}

function FormatDriveDialog({
	drive,
	onOpenChange,
	open,
}: {
	drive: DriveRow;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [filesystem, setFilesystem] = useState(drive.filesystem ?? "ext4");
	const [mountpoint, setMountpoint] = useState(drive.mountpoint ?? "/data");

	// Re-seed from the drive each time the dialog opens (a cancelled edit
	// shouldn't linger on reopen — same reasoning as the rename dialog).
	useEffect(() => {
		if (open) {
			setFilesystem(drive.filesystem ?? "ext4");
			setMountpoint(drive.mountpoint ?? "/data");
		}
	}, [open, drive.filesystem, drive.mountpoint]);

	function submit() {
		formatDrive(drive.id, filesystem, mountpoint.trim());
		toast.success(`Formatted ${drive.device} as ${filesystem}.`);
		onOpenChange(false);
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
							<Select onValueChange={setFilesystem} value={filesystem}>
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
							disabled={mountpoint.trim() === ""}
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
	onOpenChange,
	open,
}: {
	drive: DriveRow;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [mountpoint, setMountpoint] = useState("/data");

	useEffect(() => {
		if (open) {
			setMountpoint("/data");
		}
	}, [open]);

	function submit() {
		mountDrive(drive.id, mountpoint.trim());
		toast.success(`Mounted ${drive.device} at ${mountpoint.trim()}.`);
		onOpenChange(false);
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
						<Button disabled={mountpoint.trim() === ""} type="submit">
							Mount
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
