import { useSyncExternalStore } from "react";
import { slugify } from "@/lib/slug";

// Mutable client-side stub store for organizations (the tenant). Real orgs come
// from the auth/identity layer; here a small seeded set + an active selection
// stands in so the org switcher works. Seed ids are deterministic (SSR-safe);
// orgs created at runtime use crypto ids. Replaced when auth lands.

export type Org = {
	id: string;
	name: string;
	slug: string;
};

type State = { orgs: Org[]; activeId: string };

const SEED: Org[] = [
	{
		id: "7c9e6a52-3f1b-4d8a-9e2c-1a4b6d8f0e21",
		name: "Acme Gaming",
		slug: "acme-gaming",
	},
	{
		id: "b3d8f1a4-6c2e-4a90-8b15-7e0c3d9f2a64",
		name: "Northwind Servers",
		slug: "northwind-servers",
	},
];

let state: State = { orgs: SEED, activeId: SEED[0].id };
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
	return state;
}

export function useOrgs(): Org[] {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).orgs;
}

export function useActiveOrg(): Org {
	const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return (
		current.orgs.find((org) => org.id === current.activeId) ?? current.orgs[0]
	);
}

export function setActiveOrg(id: string) {
	state = { ...state, activeId: id };
	emit();
}

export function createOrg(name: string): Org {
	const org: Org = {
		id: crypto.randomUUID(),
		name: name.trim(),
		slug: slugify(name) || "new-org",
	};
	state = { orgs: [...state.orgs, org], activeId: org.id };
	emit();
	return org;
}
