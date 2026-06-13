import { useSyncExternalStore } from "react";
import { SERVERS } from "@/lib/stubs";

// Mutable client-side stub store for server backups — snapshots of a server's
// data volume (daemon-owned in the real product, deduplicated with retention).
// Seeded with a couple per server; creating one simulates progress then lands a
// completed snapshot. Seed ids are deterministic so SSR and the first client
// render agree; runtime backups use crypto ids. Replaced when the daemon lands.

export type BackupStatus = "creating" | "completed" | "failed";

export type Backup = {
	id: string;
	serverId: string;
	name: string;
	/** Pre-formatted creation time for the UI-first phase. */
	createdAt: string;
	sizeBytes: number;
	status: BackupStatus;
	/** Locked backups are kept past retention and can't be deleted. */
	locked: boolean;
};

const GiB = 1024 ** 3;

function seed(): Backup[] {
	const out: Backup[] = [];
	for (const server of SERVERS) {
		const base = server.diskUsedBytes ?? 1.2 * GiB;
		out.push(
			{
				id: `${server.id}-bk-1`,
				serverId: server.id,
				name: "Daily backup",
				createdAt: "8 hours ago",
				sizeBytes: Math.round(base * 0.6),
				status: "completed",
				locked: false,
			},
			{
				id: `${server.id}-bk-2`,
				serverId: server.id,
				name: "Before update",
				createdAt: "3 days ago",
				sizeBytes: Math.round(base * 0.55),
				status: "completed",
				locked: true,
			}
		);
	}
	return out;
}

let backups: Backup[] = seed();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return backups;
}

export function useServerBackups(serverId: string): Backup[] {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).filter(
		(backup) => backup.serverId === serverId
	);
}

function patch(id: string, next: Partial<Backup>) {
	backups = backups.map((backup) =>
		backup.id === id ? { ...backup, ...next } : backup
	);
	emit();
}

/** Start a backup: lands a `creating` row, then completes after a short delay. */
export function createBackup(serverId: string, name: string) {
	const id = crypto.randomUUID();
	const server = SERVERS.find((entry) => entry.id === serverId);
	const sizeBytes = Math.round((server?.diskUsedBytes ?? 1.2 * GiB) * 0.6);
	backups = [
		{
			id,
			serverId,
			name,
			createdAt: "Just now",
			sizeBytes,
			status: "creating",
			locked: false,
		},
		...backups,
	];
	emit();
	timers.set(
		id,
		setTimeout(() => {
			timers.delete(id);
			patch(id, { status: "completed" });
		}, 2600)
	);
}

export function deleteBackup(id: string) {
	const timer = timers.get(id);
	if (timer) {
		clearTimeout(timer);
		timers.delete(id);
	}
	backups = backups.filter((backup) => backup.id !== id);
	emit();
}

export function toggleBackupLock(id: string) {
	backups = backups.map((backup) =>
		backup.id === id ? { ...backup, locked: !backup.locked } : backup
	);
	emit();
}
