import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { NetworkRow } from "@/lib/domain/networks";
import {
	createNetwork as createNetworkFn,
	deleteNetwork as deleteNetworkFn,
	listNetworks,
	nodeFirewall,
	setServerNetwork as setServerNetworkFn,
} from "@/server/networking";

// Networks + firewall are daemon-derived on-demand reads (no panel table). The
// org-wide network list aggregates every online node; the firewall is a per-node
// `{ ok } | { error }` read polled while focused.

export function networksListQueryOptions() {
	return queryOptions({
		queryKey: ["networks", "list"] as const,
		queryFn: () => listNetworks(),
		staleTime: 10_000,
		refetchInterval: 20_000,
	});
}

export function nodeFirewallQueryOptions(nodeId: string) {
	return queryOptions({
		queryKey: ["node-live", "firewall", nodeId] as const,
		queryFn: () => nodeFirewall({ data: { nodeId } }),
		retry: false,
		// The firewall only changes via panel actions (allocations open/close it),
		// and those invalidate this key on success. So poll slowly — just enough to
		// reconcile a rare out-of-band change — rather than dialing the box often.
		refetchInterval: 60_000,
	});
}

export function useNetworks(): NetworkRow[] {
	return useQuery(networksListQueryOptions()).data ?? [];
}

export function createNetwork(input: {
	nodeId: string;
	name: string;
	driver: NetworkRow["driver"];
	subnet?: string;
	gateway?: string;
}) {
	return createNetworkFn({ data: input });
}

export function deleteNetwork(nodeId: string, networkId: string) {
	return deleteNetworkFn({ data: { nodeId, networkId } });
}

export function setServerNetwork(
	networkId: string,
	serverId: string,
	action: "attach" | "detach"
) {
	return setServerNetworkFn({ data: { networkId, serverId, action } });
}

export function invalidateNetworks(queryClient: QueryClient): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["networks"] });
}
