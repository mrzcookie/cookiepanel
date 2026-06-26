import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Archive,
	Loader2,
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
	createBackup,
	deleteBackup,
	invalidateBackups,
	restoreBackup,
	setBackupLock,
	useServerBackups,
} from "@/lib/backups-queries";
import type { Backup } from "@/lib/domain/backups";
import { formatBytes } from "@/lib/format";
import { useServer } from "@/lib/server-queries";

export const Route = createFileRoute("/_app/servers/$serverId/backups")({
	component: ServerBackupsTab,
});

const RETENTION = 10;

function ServerBackupsTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const { data, isLoading } = useServerBackups(serverId);
	const [createOpen, setCreateOpen] = useState(false);

	if (!server) {
		return null;
	}

	const backups = data?.ok ? data.data : [];
	const unreachable = Boolean(data && !data.ok);
	const atLimit = backups.length >= RETENTION;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Backups</CardTitle>
				<CardDescription>
					Snapshots of this server's data volume, kept on the node and
					deduplicated. Lock one to keep it from being deleted.
				</CardDescription>
				<CardAction>
					<Button
						disabled={atLimit || unreachable}
						onClick={() => setCreateOpen(true)}
						size="sm"
					>
						<Plus />
						Create backup
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
						<Loader2 className="size-4 animate-spin" />
						Loading backups…
					</div>
				) : unreachable ? (
					<div className="rounded-lg border border-warn/40 bg-warn-wash py-12 text-center text-sm text-warn-foreground">
						Can't reach this server's node, so its backups aren't available
						right now.
					</div>
				) : backups.length === 0 ? (
					<EmptyState
						description="Create a backup to snapshot this server's data volume."
						icon={Archive}
						title="No backups yet"
					/>
				) : (
					<ul className="divide-y">
						{backups.map((backup) => (
							<BackupRow backup={backup} key={backup.id} serverId={serverId} />
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

function BackupRow({ backup, serverId }: { backup: Backup; serverId: string }) {
	const creating = backup.status === "creating";
	const failed = backup.status === "failed";

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
					{failed ? <Badge variant="destructive">Failed</Badge> : null}
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{creating ? (
						<span className="inline-flex items-center gap-1.5">
							<Loader2 className="size-3 animate-spin" />
							Creating…
						</span>
					) : failed ? (
						(backup.error ?? "Backup failed.")
					) : (
						`${backup.createdAt ?? "just now"} · ${formatBytes(backup.sizeBytes)}`
					)}
				</div>
			</div>
			{creating ? null : <BackupActions backup={backup} serverId={serverId} />}
		</li>
	);
}

function BackupActions({
	backup,
	serverId,
}: {
	backup: Backup;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [restoreOpen, setRestoreOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const failed = backup.status === "failed";

	function refresh() {
		return invalidateBackups(queryClient, serverId);
	}

	async function restore() {
		setRestoreOpen(false);
		const dismiss = toast.loading(`Restoring “${backup.name}”…`);
		try {
			await restoreBackup(serverId, backup.id);
			await refresh();
			toast.success(`Restored “${backup.name}”. The server was stopped.`, {
				id: dismiss,
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't restore.",
				{ id: dismiss }
			);
		}
	}

	async function toggleLock() {
		setBusy(true);
		try {
			await setBackupLock(serverId, backup.id, !backup.locked);
			await refresh();
			toast.success(backup.locked ? "Backup unlocked." : "Backup locked.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the lock."
			);
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		try {
			await deleteBackup(serverId, backup.id);
			await refresh();
			toast.success(`Deleted “${backup.name}”.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't delete the backup."
			);
		}
	}

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
					{failed ? null : (
						<>
							<DropdownMenuItem onClick={() => setRestoreOpen(true)}>
								<RotateCcw />
								Restore
							</DropdownMenuItem>
							<DropdownMenuItem disabled={busy} onClick={toggleLock}>
								{backup.locked ? <LockOpen /> : <Lock />}
								{backup.locked ? "Unlock" : "Lock"}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem
						disabled={backup.locked}
						onClick={() => setDeleteOpen(true)}
						variant="destructive"
					>
						<Trash2 />
						{failed ? "Dismiss" : "Delete"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog onOpenChange={setRestoreOpen} open={restoreOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Restore this backup?</DialogTitle>
						<DialogDescription>
							Restoring “{backup.name}” replaces the server's current data with
							this snapshot. The server is stopped first, and stays stopped
							after — start it again when you're ready.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button onClick={restore}>Restore</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{failed ? "Dismiss" : "Delete"} this backup?
						</DialogTitle>
						<DialogDescription>
							Permanently {failed ? "dismiss" : "delete"} “{backup.name}”. This
							can't be undone.
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
								remove();
								setDeleteOpen(false);
							}}
							variant="destructive"
						>
							{failed ? "Dismiss" : "Delete"}
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
	const queryClient = useQueryClient();
	const [name, setName] = useState("Manual backup");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setName("Manual backup");
		}
	}, [open]);

	async function submit() {
		setBusy(true);
		try {
			await createBackup(serverId, name.trim() || "Manual backup");
			await invalidateBackups(queryClient, serverId);
			toast.success("Creating backup…");
			onOpenChange(false);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't start the backup."
			);
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
						<Button disabled={busy} type="submit">
							{busy ? "Starting…" : "Create backup"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
