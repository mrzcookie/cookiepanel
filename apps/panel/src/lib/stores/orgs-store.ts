import { createStore } from "@/lib/store";

// Mutable client-side stub store for organizations (the tenant). The org switcher
// now runs on real Better Auth orgs; this seeded set remains only as the
// active-org source for the still-stubbed billing + admin surfaces, and is
// removed when those features are wired. Seed ids are deterministic (SSR-safe).

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

// Several orgs so per-org billing is visible: switching orgs tours the billing
// lifecycle (active / trial / past due / no plan) — see lib/stores/billing-store.
const SEED: Org[] = [
	DEFAULT_ORG,
	{
		id: "b3d8f1a4-6c2e-4a90-8b15-7e0c3d9f2a64",
		name: "Northwind Servers",
		slug: "northwind-servers",
	},
	{
		id: "c4e9a2b5-7d3f-4b01-9c26-8f1d4e0a3b75",
		name: "Pixelforge Collective",
		slug: "pixelforge-collective",
	},
	{
		id: "d5f0b3c6-8e4a-4c12-8d37-9a2e5f1b4c86",
		name: "Lone Pine Studio",
		slug: "lone-pine-studio",
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
