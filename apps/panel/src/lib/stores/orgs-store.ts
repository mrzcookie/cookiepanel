import { slugify } from "@/lib/slug";
import { createStore } from "@/lib/store";

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

const DEFAULT_ORG: Org = {
	id: "7c9e6a52-3f1b-4d8a-9e2c-1a4b6d8f0e21",
	name: "Acme Gaming",
	slug: "acme-gaming",
};

const SEED: Org[] = [
	DEFAULT_ORG,
	{
		id: "b3d8f1a4-6c2e-4a90-8b15-7e0c3d9f2a64",
		name: "Northwind Servers",
		slug: "northwind-servers",
	},
];

const store = createStore<State>({ orgs: SEED, activeId: DEFAULT_ORG.id });

export function useOrgs(): Org[] {
	return store.use().orgs;
}

export function useActiveOrg(): Org {
	const current = store.use();
	return (
		current.orgs.find((org) => org.id === current.activeId) ??
		current.orgs[0] ??
		DEFAULT_ORG
	);
}

export function setActiveOrg(id: string) {
	store.set({ ...store.get(), activeId: id });
}

export function createOrg(name: string): Org {
	const org: Org = {
		id: crypto.randomUUID(),
		name: name.trim(),
		slug: slugify(name) || "new-org",
	};
	store.set({ orgs: [...store.get().orgs, org], activeId: org.id });
	return org;
}
