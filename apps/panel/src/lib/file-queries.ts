import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { FileTransfer } from "@/lib/domain/files";
import {
	createDirectory as createDirectoryFn,
	createFile as createFileFn,
	deleteEntry as deleteEntryFn,
	listFiles,
	pullUrl as pullUrlFn,
	readFile,
	renameEntry as renameEntryFn,
	urlJobStatus,
	writeFile as writeFileFn,
} from "@/server/files";

// Query factories + read hooks + mutation wrappers for the file manager — the
// daemon-derived per-directory listing, file contents, and URL-pull job polling.
// Keyed under `["files", serverId]` so one invalidation refreshes the open
// directory. Binary upload/download hit the `/api/files/*` route handlers (they
// stream raw bytes, which a server function can't).

function filesQueryOptions(serverId: string, path: string) {
	return queryOptions({
		queryKey: ["files", serverId, path] as const,
		queryFn: () => listFiles({ data: { serverId, path } }),
		// A bad path / unreachable box is a real error to surface, not a retry loop.
		retry: false,
		staleTime: 5_000,
	});
}

export function useFiles(serverId: string, path: string) {
	return useQuery(filesQueryOptions(serverId, path));
}

/** One file's contents, for the editor. Not cached long — reopen reads fresh. */
export function fileContentQueryOptions(serverId: string, path: string) {
	return queryOptions({
		queryKey: ["file-content", serverId, path] as const,
		queryFn: () => readFile({ data: { serverId, path } }),
		retry: false,
		staleTime: 0,
		gcTime: 0,
	});
}

/** Polls one URL-download job until it leaves the running state. */
export function urlJobQueryOptions(serverId: string, jobId: string) {
	return queryOptions({
		queryKey: ["url-job", serverId, jobId] as const,
		queryFn: () => urlJobStatus({ data: { serverId, jobId } }),
		refetchInterval: (query) => {
			const data = query.state.data as FileTransfer | undefined;
			return data && data.state !== "running" ? false : 1000;
		},
	});
}

export function createDirectory(serverId: string, path: string) {
	return createDirectoryFn({ data: { serverId, path } });
}

export function createFile(serverId: string, path: string) {
	return createFileFn({ data: { serverId, path } });
}

export function renameEntry(serverId: string, from: string, to: string) {
	return renameEntryFn({ data: { serverId, from, to } });
}

export function deleteEntry(serverId: string, path: string) {
	return deleteEntryFn({ data: { serverId, path } });
}

export function writeFile(serverId: string, path: string, content: string) {
	return writeFileFn({ data: { serverId, path, content } });
}

export function pullUrl(serverId: string, path: string, url: string) {
	return pullUrlFn({ data: { serverId, path, url } });
}

export function invalidateFiles(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["files", serverId] });
}

/** Upload a file's bytes into `path` via the streaming route handler. */
export async function uploadFile(
	serverId: string,
	path: string,
	file: File
): Promise<void> {
	const res = await fetch(
		`/api/files/upload?serverId=${serverId}&path=${encodeURIComponent(path)}`,
		{ method: "POST", body: file }
	);
	if (!res.ok) {
		throw new Error((await res.text()) || "Upload failed");
	}
}

/** The download URL for a file — point an `<a download>` / `window.open` at it. */
export function fileDownloadUrl(serverId: string, path: string): string {
	return `/api/files/download?serverId=${serverId}&path=${encodeURIComponent(path)}`;
}
