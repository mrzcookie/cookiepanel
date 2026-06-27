import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { AllocationProtocol, AllocationRow } from "@/lib/domain/networks";
import {
	createAllocation as createAllocationFn,
	listNodeAllocations,
	listServerAllocations,
	removeAllocation as removeAllocationFn,
} from "@/server/allocations";

// Query factories + read hooks + mutation wrappers for port allocations — the
// panel-owned half of networking. Keyed under `["allocations"]` so one
// invalidation refreshes the node + server views.

export function nodeAllocationsQueryOptions(nodeId: string) {
	return queryOptions({
		queryKey: ["allocations", "node", nodeId] as const,
		queryFn: () => listNodeAllocations({ data: { nodeId } }),
		staleTime: 10_000,
	});
}

export function serverAllocationsQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["allocations", "server", serverId] as const,
		queryFn: () => listServerAllocations({ data: { serverId } }),
		staleTime: 10_000,
	});
}

export function useNodeAllocations(nodeId: string): AllocationRow[] {
	return useQuery(nodeAllocationsQueryOptions(nodeId)).data ?? [];
}

export function useServerAllocations(serverId: string): AllocationRow[] {
	return useQuery(serverAllocationsQueryOptions(serverId)).data ?? [];
}

export function createAllocation(input: {
	nodeId: string;
	port: number;
	protocol: AllocationProtocol;
	ip?: string;
}) {
	return createAllocationFn({ data: input });
}

export function removeAllocation(id: string) {
	return removeAllocationFn({ data: { id } });
}

export function invalidateAllocations(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["allocations"] });
}
