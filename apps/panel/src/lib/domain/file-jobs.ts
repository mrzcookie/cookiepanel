// File-job domain types (client-safe). A FileJob is an async operation on a
// server's volume — a browser upload, a server-side URL pull, or a compress /
// extract — daemon-owned in the real product (the filesystem subsystem's jobs).
// The mutable stub store lives in stores/file-jobs-store.ts.

export type FileJobKind = "upload" | "url" | "archive" | "extract";
export type FileJobStatus = "active" | "completed" | "failed";

export type FileJob = {
	id: string;
	serverId: string;
	kind: FileJobKind;
	/** The file / archive / output-folder name. */
	name: string;
	dir: string;
	/** Source URL for a `url` pull, else null. */
	source: string | null;
	status: FileJobStatus;
	/** 0–100. */
	progress: number;
	sizeBytes: number;
	error: string | null;
};
