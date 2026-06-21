import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { Template, TemplateInput } from "@/lib/domain/templates";
import type { TemplateScope } from "@/lib/templates-scope";
import {
	archiveAdminTemplate,
	createAdminTemplate,
	deleteAdminTemplate,
	getAdminEditableTemplate,
	importAdminTemplateFromJson,
	importAdminTemplateFromUrl,
	listAdminTemplates,
	publishAdminTemplate,
	unpublishAdminTemplate,
	updateAdminTemplate,
} from "@/server/admin/templates";
import {
	archiveTemplate,
	createTemplate,
	deleteTemplate,
	getEditableTemplate,
	importTemplateFromJson,
	importTemplateFromUrl,
	listTemplates,
	publishTemplate,
	unpublishTemplate,
	updateTemplate,
} from "@/server/templates";

// Query factories + read hooks + mutation routing for templates. The two
// surfaces — the org catalog (own + published official) and the admin official
// library (all official, incl. drafts) — read different server fns, so each gets
// its own keys; the consumer list strips raw image strings server-side, and the
// per-template *edit* query carries them (for the editor only). See panel.md.

// ─── org surface ─────────────────────────────────────────────────────────────

/** The active org's catalog: its own templates (any status) + published official. */
export function templatesListQueryOptions() {
	return queryOptions({
		queryKey: ["templates"] as const,
		queryFn: () => listTemplates(),
		// Templates change rarely; keep the catalog warm so cross-page reads
		// (command menu, server detail) don't refetch on every navigation.
		staleTime: 30_000,
	});
}

/** One owned template in full editor shape (raw images), for the edit route. */
export function templateEditQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["templates", "edit", id] as const,
		queryFn: () => getEditableTemplate({ data: { id } }),
	});
}

// ─── admin / official surface ────────────────────────────────────────────────

/** The whole official library (incl. drafts), for /admin/templates. */
export function adminTemplatesListQueryOptions() {
	return queryOptions({
		queryKey: ["admin", "templates"] as const,
		queryFn: () => listAdminTemplates(),
		staleTime: 30_000,
	});
}

export function adminTemplateEditQueryOptions(id: string) {
	return queryOptions({
		queryKey: ["admin", "templates", "edit", id] as const,
		queryFn: () => getAdminEditableTemplate({ data: { id } }),
	});
}

// ─── read hooks ──────────────────────────────────────────────────────────────
// Convenience wrappers for the many org-context consumers (catalog, command
// menu, server detail, deploy wizard). Backed by the warm list cache, so they
// stay in sync after any mutation invalidates it.

export function useTemplates(): Template[] {
	return useQuery(templatesListQueryOptions()).data ?? [];
}

export function useTemplate(id: string): Template | undefined {
	return useTemplates().find((template) => template.id === id);
}

export function useAdminTemplates(): Template[] {
	return useQuery(adminTemplatesListQueryOptions()).data ?? [];
}

export function useAdminTemplate(id: string): Template | undefined {
	return useAdminTemplates().find((template) => template.id === id);
}

// ─── mutations (routed by surface) ───────────────────────────────────────────
// One call shape for the shared editor/management/import UI; `templateActions`
// picks the org or admin server fns from the scope. Fork is org-only (it copies
// an official template *into* the active org) and lives on its own.

export type TemplateActions = {
	create: (input: TemplateInput) => Promise<{ id: string; name: string }>;
	update: (id: string, input: TemplateInput) => Promise<{ ok: true }>;
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
};

const orgActions: TemplateActions = {
	create: (input) => createTemplate({ data: input }),
	update: (id, input) => updateTemplate({ data: { id, input } }),
	publish: (id) => publishTemplate({ data: { id } }),
	unpublish: (id) => unpublishTemplate({ data: { id } }),
	archive: (id) => archiveTemplate({ data: { id } }),
	remove: (id) => deleteTemplate({ data: { id } }),
	importJson: (json) => importTemplateFromJson({ data: { json } }),
	importUrl: (url) => importTemplateFromUrl({ data: { url } }),
};

const adminActions: TemplateActions = {
	create: (input) => createAdminTemplate({ data: input }),
	update: (id, input) => updateAdminTemplate({ data: { id, input } }),
	publish: (id) => publishAdminTemplate({ data: { id } }),
	unpublish: (id) => unpublishAdminTemplate({ data: { id } }),
	archive: (id) => archiveAdminTemplate({ data: { id } }),
	remove: (id) => deleteAdminTemplate({ data: { id } }),
	importJson: (json) => importAdminTemplateFromJson({ data: { json } }),
	importUrl: (url) => importAdminTemplateFromUrl({ data: { url } }),
};

export function templateActions(scope: TemplateScope): TemplateActions {
	return scope.official ? adminActions : orgActions;
}

// ─── cache helpers ───────────────────────────────────────────────────────────

/**
 * Invalidate every template feed. Publishing an official template changes what
 * orgs can deploy, so a mutation on either surface refreshes both.
 */
export function invalidateTemplates(queryClient: QueryClient): Promise<void> {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: ["templates"] }),
		queryClient.invalidateQueries({ queryKey: ["admin", "templates"] }),
	]).then(() => undefined);
}

/**
 * Optimistically nudge a template's deployed-server count in the catalog cache.
 * A bridge for the still-stubbed deploy flow (servers are daemon-owned and
 * unwired, so the backend count is 0); drops out once servers report for real.
 */
export function bumpTemplateServerCount(
	queryClient: QueryClient,
	id: string,
	delta: number
): void {
	queryClient.setQueryData(
		templatesListQueryOptions().queryKey,
		(current: Template[] | undefined) =>
			current?.map((template) =>
				template.id === id
					? {
							...template,
							serverCount: Math.max(0, template.serverCount + delta),
						}
					: template
			)
	);
}
