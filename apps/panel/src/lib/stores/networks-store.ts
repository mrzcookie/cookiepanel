import type { NetworkDriver, NetworkRow } from "@/lib/domain/networks";
import type { ServerRow } from "@/lib/domain/servers";
import { createStore } from "@/lib/store";
import { NETWORKS, SERVERS } from "@/lib/stubs";

// Mutable client-side stub store for networks — a stand-in for the data layer.
// The networks list and a network's detail page are separate routes, so they
// can't share one component's state; this module is the single source of truth
// they both read, so create / delete / rename / attach / detach reflect
// everywhere. Mutations happen only in the browser; the server snapshot stays
// the seeded stub (so SSR and the first client render agree). Replaced wholesale
// when the real data layer lands.

const store = createStore<NetworkRow[]>(NETWORKS);

export function useNetworks() {
	return store.use();
}

export function useNetwork(id: string) {
	return useNetworks().find((network) => network.id === id);
}

export type NewNetwork = {
	name: string;
	nodeId: string;
	nodeName: string;
	driver: NetworkDriver;
	subnet: string | null;
	gateway: string | null;
	internal: boolean;
};

export function createNetwork(input: NewNetwork): NetworkRow {
	const network: NetworkRow = {
		id: crypto.randomUUID(),
		serverIds: [],
		...input,
	};
	store.set([network, ...store.get()]);
	return network;
}

export function deleteNetwork(id: string) {
	store.set(store.get().filter((network) => network.id !== id));
}

export function renameNetwork(id: string, name: string) {
	store.set(
		store
			.get()
			.map((network) => (network.id === id ? { ...network, name } : network))
	);
}

export function attachServer(networkId: string, serverId: string) {
	store.set(
		store
			.get()
			.map((network) =>
				network.id === networkId && !network.serverIds.includes(serverId)
					? { ...network, serverIds: [...network.serverIds, serverId] }
					: network
			)
	);
}

export function detachServer(networkId: string, serverId: string) {
	store.set(
		store.get().map((network) =>
			network.id === networkId
				? {
						...network,
						serverIds: network.serverIds.filter((id) => id !== serverId),
					}
				: network
		)
	);
}

const serverById = new Map(SERVERS.map((server) => [server.id, server]));

/** The servers attached to a network, resolved to rows. */
export function attachedServers(network: NetworkRow): ServerRow[] {
	return network.serverIds
		.map((id) => serverById.get(id))
		.filter((server): server is ServerRow => server !== undefined);
}

/** Servers on the same node that aren't attached yet — the attach picker. */
export function attachableServers(network: NetworkRow): ServerRow[] {
	return SERVERS.filter(
		(server) =>
			server.nodeName === network.nodeName &&
			!network.serverIds.includes(server.id)
	);
}
