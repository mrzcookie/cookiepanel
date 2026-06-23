import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
	closeSftpSession,
	openSftpSession,
	sftpSessionStatus,
} from "@/server/sftp";

// Query factory + mutation wrappers for SFTP sessions. The status drives the
// "session active" indicator; open mints fresh credentials (shown once), close
// revokes. Keyed under `["sftp", serverId]`.

export function sftpStatusQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["sftp", serverId] as const,
		queryFn: () => sftpSessionStatus({ data: { serverId } }),
		staleTime: 10_000,
	});
}

export function openSftp(serverId: string) {
	return openSftpSession({ data: { serverId } });
}

export function closeSftp(serverId: string) {
	return closeSftpSession({ data: { serverId } });
}

export function invalidateSftp(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["sftp", serverId] });
}
