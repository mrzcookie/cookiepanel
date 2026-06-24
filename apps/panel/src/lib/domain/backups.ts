// Backup domain types (client-safe). A Backup is a snapshot of a server's data
// volume — daemon-owned (borg, deduplicated), like the Schedule
// (domain/schedules.ts). Reads are daemon-derived (DaemonRead) via
// lib/backups-queries.ts.

export type BackupStatus = "creating" | "completed" | "failed";

export type Backup = {
	/** The borg archive name — the backup's stable id. */
	id: string;
	serverId: string;
	name: string;
	/** Pre-formatted (relative) creation time, or null while still creating. */
	createdAt: string | null;
	sizeBytes: number;
	status: BackupStatus;
	/** Failure detail when status is "failed". */
	error: string | null;
	/** Locked backups can't be deleted. */
	locked: boolean;
};
