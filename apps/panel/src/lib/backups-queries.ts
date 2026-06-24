import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import {
	createBackup as createBackupFn,
	deleteBackup as deleteBackupFn,
	listServerBackups,
	restoreBackup as restoreBackupFn,
	setBackupLock as setBackupLockFn,
} from "@/server/backups";

// Query factory + mutation wrappers for the daemon-derived backups. The read
// returns a DaemonRead (degrades offline) and polls so an async "creating" backup
// flips to completed without a manual refresh. Keyed under `["backups", serverId]`.

function serverBackupsQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["backups", serverId] as const,
		queryFn: () => listServerBackups({ data: { serverId } }),
		retry: false,
		staleTime: 5_000,
		refetchInterval: 10_000,
	});
}

export function useServerBackups(serverId: string) {
	return useQuery(serverBackupsQueryOptions(serverId));
}

export function createBackup(serverId: string, name: string) {
	return createBackupFn({ data: { serverId, name } });
}

export function restoreBackup(serverId: string, archive: string) {
	return restoreBackupFn({ data: { serverId, archive } });
}

export function setBackupLock(
	serverId: string,
	archive: string,
	locked: boolean
) {
	return setBackupLockFn({ data: { serverId, archive, locked } });
}

export function deleteBackup(serverId: string, archive: string) {
	return deleteBackupFn({ data: { serverId, archive } });
}

export function invalidateBackups(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["backups", serverId] });
}
