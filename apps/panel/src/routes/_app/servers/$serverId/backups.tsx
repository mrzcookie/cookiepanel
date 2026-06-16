import { createFileRoute } from "@tanstack/react-router";
import {
	Archive,
	Download,
	Loader,
	Lock,
	LockOpen,
	MoreHorizontal,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityIconChip } from "@/components/shared/entity-card";
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
import type { Backup } from "@/lib/domain/backups";
import { formatBytes } from "@/lib/format";
import {
	createBackup,
	deleteBackup,
	toggleBackupLock,
	useServerBackups,
} from "@/lib/stores/backups-store";
import { useServer } from "@/lib/stores/servers-store";

export const Route = createFileRoute("/_app/servers/$serverId/backups")({
	component: ServerBackupsTab,
});

const RETENTION = 10;

function ServerBackupsTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const backups = useServerBackups(serverId);
	const [createOpen, setCreateOpen] = useState(false);

	if (!server) {
		return null;
	}

	const atLimit = backups.length >= RETENTION;

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div className="space-y-1.5">
					<CardTitle>Backups</CardTitle>
					<CardDescription>
						Snapshots of this server's data volume. Up to {RETENTION} are kept;
						the oldest unlocked one is pruned when you go over.
					</CardDescription>
				</div>
				<Button
					disabled={atLimit}
					onClick={() => setCreateOpen(true)}
					size="sm"
				>
					<Plus />
					Create backup
				</Button>
			</CardHeader>
			<CardContent>
				{backups.length === 0 ? (
					<EmptyState
						description="Create a backup to snapshot this server's data volume."
						icon={Archive}
						title="No backups yet"
					/>
				) : (
					<ul className="divide-y">
						{backups.map((backup) => (
							<BackupRow backup={backup} key={backup.id} />
						))}
					</ul>
				)}
			</CardContent>

			<CreateBackupDialog
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
		</Card>
	);
}

function BackupRow({ backup }: { backup: Backup }) {
	const creating = backup.status === "creating";

	return (
		<li className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
			<EntityIconChip icon={Archive} size="sm" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium text-sm">{backup.name}</span>
					{backup.locked ? (
						<Badge variant="secondary">
							<Lock />
							Locked
						</Badge>
					) : null}
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{creating ? (
						<span className="inline-flex items-center gap-1.5">
							<Loader className="size-3 animate-spin" />
							Creating…
						</span>
					) : (
						`${backup.createdAt} · ${formatBytes(backup.sizeBytes)}`
					)}
				</div>
			</div>
			{creating ? null : <BackupActions backup={backup} />}
		</li>
	);
}

function BackupActions({ backup }: { backup: Backup }) {
	const [restoreOpen, setRestoreOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button className="text-muted-foreground" size="icon" variant="ghost">
						<MoreHorizontal />
						<span className="sr-only">Actions for {backup.name}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => setRestoreOpen(true)}>
						<RotateCcw />
						Restore
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => toast.success(`Downloading ${backup.name}…`)}
					>
						<Download />
						Download
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => {
							toggleBackupLock(backup.id);
							toast.success(
								backup.locked ? "Backup unlocked." : "Backup locked."
							);
						}}
					>
						{backup.locked ? <LockOpen /> : <Lock />}
						{backup.locked ? "Unlock" : "Lock"}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						disabled={backup.locked}
						onClick={() => setDeleteOpen(true)}
						variant="destructive"
					>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog onOpenChange={setRestoreOpen} open={restoreOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Restore this backup?</DialogTitle>
						<DialogDescription>
							Restoring “{backup.name}” ({backup.createdAt}) replaces the
							server's current data with this snapshot. The server is stopped
							while it restores.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							onClick={() => {
								setRestoreOpen(false);
								toast.success(`Restoring “${backup.name}”…`);
							}}
						>
							Restore
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this backup?</DialogTitle>
						<DialogDescription>
							Permanently delete “{backup.name}”. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							onClick={() => {
								deleteBackup(backup.id);
								toast.success(`Deleted “${backup.name}”.`);
							}}
							variant="destructive"
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function CreateBackupDialog({
	onOpenChange,
	open,
	serverId,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [name, setName] = useState("Manual backup");

	useEffect(() => {
		if (open) {
			setName("Manual backup");
		}
	}, [open]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const trimmed = name.trim() || "Manual backup";
						createBackup(serverId, trimmed);
						toast.success("Creating backup…");
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Create a backup</DialogTitle>
						<DialogDescription>
							Snapshot the server's data volume now. Give it a name you'll
							recognize.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="backup-name">Name</Label>
						<Input
							autoFocus
							id="backup-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit">Create backup</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
