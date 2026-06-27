import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { Egg, EggInput } from "@/lib/domain/eggs";
import type { EggScope } from "@/lib/eggs-scope";
import {
	archiveAdminEgg,
	createAdminEgg,
	deleteAdminEgg,
	getAdminEditableEgg,
	importAdminEggFromJson,
	importAdminEggFromUrl,
	listAdminEggs,
	publishAdminEgg,
	unpublishAdminEgg,
	updateAdminEgg,
	uploadAdminEggIcon,
} from "@/server/admin/eggs";
import {
	archiveEgg,
	createEgg,
	deleteEgg,
	getEditableEgg,
	importEggFromJson,
	importEggFromUrl,
	listEggs,
	publishEgg,
	unpublishEgg,
	updateEgg,
	uploadEggIcon,
} from "@/server/eggs";

// Query factories + read hooks + mutation routing for eggs. The two
// surfaces — the org catalog (own + published official) and the admin official
// library (all official, incl. drafts) — read different server fns, so each gets
// its own keys; the consumer list strips raw image strings server-side, and the
// per-egg *edit* query carries them (for the editor only). See panel.md.

// ─── org surface ─────────────────────────────────────────────────────────────

/** The active org's catalog: its own eggs (any status) + published official. */
export function eggsListQueryOptions() {
	return queryOptions({
		queryKey: ["eggs"] as const,
		queryFn: () => listEggs(),
		// Eggs change rarely; keep the catalog warm so cross-page reads
		// (command menu, server detail) don't refetch on every navigation.
		staleTime: 30_000,
	});
}

/** One owned egg in full editor shape (raw images), for the edit route. */
export function eggEditQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["eggs", "edit", id] as const,
		queryFn: () => getEditableEgg({ data: { id } }),
	});
}

// ─── admin / official surface ────────────────────────────────────────────────

/** The whole official library (incl. drafts), for /admin/eggs. */
export function adminEggsListQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "eggs"] as const,
		queryFn: () => listAdminEggs(),
		staleTime: 30_000,
	});
}

export function adminEggEditQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["admin", "eggs", "edit", id] as const,
		queryFn: () => getAdminEditableEgg({ data: { id } }),
	});
}

// ─── read hooks ──────────────────────────────────────────────────────────────
// Convenience wrappers for the many org-context consumers (catalog, command
// menu, server detail, deploy wizard). Backed by the warm list cache, so they
// stay in sync after any mutation invalidates it.

export function useEggs(): Egg[] {
	return useQuery(eggsListQueryOptions()).data ?? [];
}

export function useEgg(id: string): Egg | undefined {
	return useEggs().find((egg) => egg.id === id);
}

export function useAdminEggs(): Egg[] {
	return useQuery(adminEggsListQueryOptions()).data ?? [];
}

export function useAdminEgg(id: string): Egg | undefined {
	return useAdminEggs().find((egg) => egg.id === id);
}

// ─── mutations (routed by surface) ───────────────────────────────────────────
// One call shape for the shared editor/management/import UI; `eggActions`
// picks the org or admin server fns from the scope. Fork is org-only (it copies
// an official egg *into* the active org) and lives on its own.

export type EggActions = {
	create: (input: EggInput) => Promise<{ id: string; name: string }>;
	update: (id: string, input: EggInput) => Promise<{ ok: true }>;
	publish: (id: string) => Promise<{ ok: true; version: number }>;
	unpublish: (id: string) => Promise<{ ok: true }>;
	archive: (id: string) => Promise<{ ok: true }>;
	remove: (id: string) => Promise<{ ok: boolean; refCount: number }>;
	importJson: (
		json: string
	) => Promise<{ id: string; name: string; warnings: string[] }>;
	importUrl: (
		url: string
	) => Promise<{ id: string; name: string; warnings: string[] }>;
	uploadIcon: (file: File) => Promise<{ iconUrl: string }>;
};

/** A picked image File as the multipart body the upload server fns validate. */
function iconUpload(file: File): FormData {
	const body = new FormData();
	body.append("file", file);
	return body;
}

const orgActions: EggActions = {
	create: (input) => createEgg({ data: input }),
	update: (id, input) => updateEgg({ data: { id, input } }),
	publish: (id) => publishEgg({ data: { id } }),
	unpublish: (id) => unpublishEgg({ data: { id } }),
	archive: (id) => archiveEgg({ data: { id } }),
	remove: (id) => deleteEgg({ data: { id } }),
	importJson: (json) => importEggFromJson({ data: { json } }),
	importUrl: (url) => importEggFromUrl({ data: { url } }),
	uploadIcon: (file) => uploadEggIcon({ data: iconUpload(file) }),
};

const adminActions: EggActions = {
	create: (input) => createAdminEgg({ data: input }),
	update: (id, input) => updateAdminEgg({ data: { id, input } }),
	publish: (id) => publishAdminEgg({ data: { id } }),
	unpublish: (id) => unpublishAdminEgg({ data: { id } }),
	archive: (id) => archiveAdminEgg({ data: { id } }),
	remove: (id) => deleteAdminEgg({ data: { id } }),
	importJson: (json) => importAdminEggFromJson({ data: { json } }),
	importUrl: (url) => importAdminEggFromUrl({ data: { url } }),
	uploadIcon: (file) => uploadAdminEggIcon({ data: iconUpload(file) }),
};

export function eggActions(scope: EggScope): EggActions {
	return scope.official ? adminActions : orgActions;
}

// ─── cache helpers ───────────────────────────────────────────────────────────

/**
 * Invalidate every egg feed. Publishing an official egg changes what
 * orgs can deploy, so a mutation on either surface refreshes both.
 */
export function invalidateEggs(queryClient: QueryClient): Promise<void> {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["eggs"] }),
		queryClient.invalidateQueries({ queryKey: ["admin", "eggs"] }),
	]).then(() => undefined);
}

/**
 * Optimistically nudge an egg's deployed-server count in the catalog cache.
 * A bridge for the still-stubbed deploy flow (servers are daemon-owned and
 * unwired, so the backend count is 0); drops out once servers report for real.
 */
export function bumpEggServerCount(
	queryClient: QueryClient,
	id: string,
	delta: number
): void {
	queryClient.setQueryData(
		eggsListQueryOptions().queryKey,
		(current: Egg[] | undefined) =>
			current?.map((egg) =>
				egg.id === id
					? {
							...egg,
							serverCount: Math.max(0, egg.serverCount + delta),
						}
					: egg
			)
	);
}
