import { isTextExtension, joinPath } from "@/lib/domain/files";
import { createStore } from "@/lib/store";
import { addNodes, uploadFile } from "@/lib/stores/files-store";

// Async file operations on a server's volume, surfaced as progress rows in the
// Files tab: browser uploads, server-side URL pulls, and compress / extract
// jobs. A stand-in for the daemon's real jobs — progress is simulated, and a
// job mutates the file tree (via files-store) when it finishes, then auto-clears
// a few seconds later. Client-only: jobs start from a user action, never SSR.

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

const store = createStore<FileJob[]>([]);
const timers = new Map<string, ReturnType<typeof setInterval>>();

/** A server's jobs (stable reference until they change). */
export function useFileJobs(serverId: string): FileJob[] {
	return store.use().filter((job) => job.serverId === serverId);
}

function patch(id: string, next: Partial<FileJob>) {
	store.set(
		store.get().map((job) => (job.id === id ? { ...job, ...next } : job))
	);
}

function add(job: FileJob) {
	store.set([job, ...store.get()]);
}

export function dismissJob(id: string) {
	const timer = timers.get(id);
	if (timer) {
		clearInterval(timer);
		timers.delete(id);
	}
	store.set(store.get().filter((job) => job.id !== id));
}

// Animate a job to 100%, run `finalize` (which mutates the tree), mark it
// completed, then auto-dismiss its row.
function run(
	id: string,
	stepMs: number,
	increment: number,
	finalize: () => void
) {
	const timer = setInterval(() => {
		const job = store.get().find((entry) => entry.id === id);
		if (job?.status !== "active") {
			clearInterval(timer);
			timers.delete(id);
			return;
		}
		const next = Math.min(100, Math.round(job.progress + increment));
		if (next >= 100) {
			clearInterval(timer);
			finalize();
			patch(id, { progress: 100, status: "completed" });
			// Reuse the timers slot so a manual dismiss also cancels the auto-clear.
			timers.set(
				id,
				setTimeout(() => dismissJob(id), 4000)
			);
		} else {
			patch(id, { progress: next });
		}
	}, stepMs);
	timers.set(id, timer);
}

export function startUpload(serverId: string, dir: string, file: File) {
	const id = crypto.randomUUID();
	add({
		id,
		serverId,
		kind: "upload",
		name: file.name,
		dir,
		source: null,
		status: "active",
		progress: 0,
		sizeBytes: file.size,
		error: null,
	});
	const begin = (content?: string) =>
		run(id, 130, 16, () =>
			uploadFile(serverId, dir, file.name, file.size, content)
		);
	// Read small text files so they're editable after upload; everything else
	// arrives download-only (matches isTextFile, which keys off content presence).
	const textLike = file.type.startsWith("text/") || isTextExtension(file.name);
	if (textLike && file.size < 512 * 1024) {
		const reader = new FileReader();
		reader.onload = () =>
			begin(typeof reader.result === "string" ? reader.result : undefined);
		reader.onerror = () => begin(undefined);
		reader.readAsText(file);
	} else {
		begin(undefined);
	}
}

export function startUrlPull(
	serverId: string,
	dir: string,
	url: string,
	name: string
) {
	const id = crypto.randomUUID();
	// The real size is unknown until the daemon fetches it; estimate one so the
	// progress row reads believably.
	const sizeBytes = 1_500_000 + Math.floor(Math.random() * 30_000_000);
	add({
		id,
		serverId,
		kind: "url",
		name,
		dir,
		source: url,
		status: "active",
		progress: 0,
		sizeBytes,
		error: null,
	});
	run(id, 220, 9, () => uploadFile(serverId, dir, name, sizeBytes, undefined));
}

/** Compress sources into a new archive `name` in `dir`. The caller has already
 * made `name` unique and estimated `sizeBytes`. */
export function startArchive(
	serverId: string,
	dir: string,
	name: string,
	sizeBytes: number
) {
	const id = crypto.randomUUID();
	add({
		id,
		serverId,
		kind: "archive",
		name,
		dir,
		source: null,
		status: "active",
		progress: 0,
		sizeBytes,
		error: null,
	});
	run(id, 150, 13, () => uploadFile(serverId, dir, name, sizeBytes, undefined));
}

/** Extract an archive into a new `folderName` under `dir`. The stub writes a
 * placeholder folder so the flow is exercised; the daemon will unpack for real. */
export function startExtract(
	serverId: string,
	dir: string,
	folderName: string,
	archiveName: string,
	sizeBytes: number
) {
	const id = crypto.randomUUID();
	add({
		id,
		serverId,
		kind: "extract",
		name: folderName,
		dir,
		source: null,
		status: "active",
		progress: 0,
		sizeBytes,
		error: null,
	});
	const outDir = joinPath(dir, folderName);
	run(id, 170, 11, () =>
		addNodes(serverId, [
			{
				path: outDir,
				name: folderName,
				kind: "directory",
				size: 0,
				modifiedAt: "Just now",
			},
			{
				path: joinPath(outDir, "contents.txt"),
				name: "contents.txt",
				kind: "file",
				size: 64,
				modifiedAt: "Just now",
				content: `Extracted from ${archiveName}.\n`,
			},
		])
	);
}
