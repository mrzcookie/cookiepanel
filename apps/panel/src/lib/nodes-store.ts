import { useSyncExternalStore } from "react";
import { NODES, type NodeCaps, type NodeRow } from "@/lib/stubs";

// Mutable client-side stub store for nodes — the stand-in for the data layer.
// The node list and the node detail tabs are separate routes, so they share this
// one source of truth; rename / remove / cap edits on the Settings tab reflect on
// the list without a reload. Mutations happen only in the browser; the server
// snapshot stays the seeded stub (SSR and the first client render agree).
// Replaced wholesale when the real data layer lands.

let nodes: NodeRow[] = NODES;
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return nodes;
}

export function useNodes() {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useNode(id: string) {
	return useNodes().find((node) => node.id === id);
}

export function renameNode(id: string, name: string) {
	nodes = nodes.map((node) =>
		node.id === id ? { ...node, name: name.trim() } : node
	);
	emit();
}

export function updateNode(
	id: string,
	patch: Partial<Pick<NodeRow, "name" | "fqdn" | "daemonPort" | "publicIp">>
) {
	nodes = nodes.map((node) => (node.id === id ? { ...node, ...patch } : node));
	emit();
}

export function removeNode(id: string) {
	nodes = nodes.filter((node) => node.id !== id);
	emit();
}

export function updateNodeCaps(id: string, caps: NodeCaps) {
	nodes = nodes.map((node) => (node.id === id ? { ...node, caps } : node));
	emit();
}
