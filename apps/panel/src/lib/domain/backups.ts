// Backup domain types (client-safe). A Backup is a snapshot of a server's data
// volume — daemon-owned in the real product, deduplicated with retention. Pairs
// with the daemon-owned Schedule (domain/schedules.ts); the mutable stub store
// lives in stores/backups-store.ts.

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
