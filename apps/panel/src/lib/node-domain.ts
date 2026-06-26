// The base domain managed nodes get a subdomain under: a managed node is
// reachable at `<node-slug>.<NODES_DOMAIN>` (e.g. `game-eu.nodes.raptorpanel.net`).
//
// Client-safe and shared: the wizard reads it to preview the address, and the
// `createNode` server fn reads it to build the authoritative FQDN — one source so
// the preview and the stored value can't drift. It's non-secret public config, so
// it rides a build-time `VITE_` var (Vite inlines it into both bundles) rather
// than the server-only t3-env. Change the domain by setting `VITE_NODES_DOMAIN`.

export const DEFAULT_NODES_DOMAIN = "nodes.raptorpanel.net";

export const NODES_DOMAIN: string =
	import.meta.env.VITE_NODES_DOMAIN ?? DEFAULT_NODES_DOMAIN;
