import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { ScheduleFrequency, ScheduleStep } from "@/lib/domain/schedules";
import {
	deleteSchedule as deleteScheduleFn,
	listServerSchedules,
	runScheduleNow,
	upsertSchedule as upsertScheduleFn,
} from "@/server/schedules";

// Query factory + mutation wrappers for the daemon-derived schedules. The read
// returns a DaemonRead (degrades when the node is unreachable); mutations throw.
// Keyed under `["schedules", serverId]`.

function serverSchedulesQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["schedules", serverId] as const,
		queryFn: () => listServerSchedules({ data: { serverId } }),
		retry: false,
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
}

export function useServerSchedules(serverId: string) {
	return useQuery(serverSchedulesQueryOptions(serverId));
}

export function upsertSchedule(input: {
	serverId: string;
	id?: string;
	name: string;
	frequency: ScheduleFrequency;
	time: string;
	dayOfWeek: number;
	enabled: boolean;
	steps: ScheduleStep[];
}) {
	return upsertScheduleFn({ data: input });
}

export function deleteSchedule(serverId: string, id: string) {
	return deleteScheduleFn({ data: { serverId, id } });
}

export function runSchedule(serverId: string, id: string) {
	return runScheduleNow({ data: { serverId, id } });
}

export function invalidateSchedules(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["schedules", serverId] });
}
