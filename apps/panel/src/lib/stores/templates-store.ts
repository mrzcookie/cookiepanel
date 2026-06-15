import type {
	Template,
	TemplateImage,
	TemplateInput,
	TemplateVariable,
} from "@/lib/domain/templates";
import { slugify } from "@/lib/slug";
import { createStore } from "@/lib/store";
import { TEMPLATES } from "@/lib/stubs";

// Mutable client-side stub store for templates — a stand-in for the data layer.
// The catalog, a template's detail page, and the editor are separate routes, so
// they can't share one component's state; this module is the single source of
// truth they all read, so create / edit / publish / fork / delete reflect
// everywhere. Mutations happen only in the browser; the server snapshot stays
// the seeded stub (SSR and the first client render agree). Replaced wholesale
// when the real data layer lands.

const store = createStore<Template[]>(TEMPLATES);

export function useTemplates() {
	return store.use();
}

export function useTemplate(id: string) {
	return useTemplates().find((template) => template.id === id);
}

// — Helpers ———————————————————————————————————————————————————————————————————

function withIds(images: TemplateInput["images"]): TemplateImage[] {
	// At least one runtime is the default; never leave a list with no default.
	const hasDefault = images.some((image) => image.isDefault);
	return images.map((image, index) => ({
		id: crypto.randomUUID(),
		label: image.label,
		image: image.image,
		isDefault: image.isDefault || (!hasDefault && index === 0),
	}));
}

function variablesWithIds(
	variables: TemplateInput["variables"]
): TemplateVariable[] {
	return variables.map((variable) => ({
		id: crypto.randomUUID(),
		...variable,
	}));
}

function replace(id: string, next: (current: Template) => Template) {
	store.set(
		store
			.get()
			.map((template) => (template.id === id ? next(template) : template))
	);
}

// — Mutations —————————————————————————————————————————————————————————————————

/**
 * Create a new draft template from editor input. `official` mints a
 * platform-owned template (the admin library); the default is an org-owned one.
 */
export function createTemplate(
	input: TemplateInput,
	opts?: { official?: boolean }
): Template {
	const official = opts?.official ?? false;
	const template: Template = {
		id: crypto.randomUUID(),
		name: input.name.trim(),
		slug: slugify(input.name) || "untitled-template",
		summary: input.summary.trim(),
		description: input.description,
		category: input.category,
		iconUrl: input.iconUrl,
		official,
		origin: official ? "official" : "scratch",
		status: "draft",
		version: 1,
		serverCount: 0,
		updatedAt: "Just now",
		parentName: null,
		images: withIds(input.images),
		variables: variablesWithIds(input.variables),
		startupCommand: input.startupCommand,
		stopType: input.stopType,
		stopValue: input.stopValue,
		doneMarkers: input.doneMarkers,
		installScript: input.installScript,
		installContainerImage: input.installContainerImage,
		installEntrypoint: input.installEntrypoint,
		features: input.features,
	};
	store.set([template, ...store.get()]);
	return template;
}

/** Apply editor input to an existing template. */
export function updateTemplate(id: string, input: TemplateInput) {
	replace(id, (current) => ({
		...current,
		name: input.name.trim(),
		slug: slugify(input.name) || current.slug,
		summary: input.summary.trim(),
		description: input.description,
		category: input.category,
		iconUrl: input.iconUrl,
		images: withIds(input.images),
		variables: variablesWithIds(input.variables),
		startupCommand: input.startupCommand,
		stopType: input.stopType,
		stopValue: input.stopValue,
		doneMarkers: input.doneMarkers,
		installScript: input.installScript,
		installContainerImage: input.installContainerImage,
		installEntrypoint: input.installEntrypoint,
		updatedAt: "Just now",
		features: input.features,
	}));
}

/** Bump the deployed-server count after a server is launched from a template. */
export function incrementTemplateServerCount(id: string) {
	replace(id, (current) => ({
		...current,
		serverCount: current.serverCount + 1,
	}));
}

/** Publish (or re-publish), bumping the version. Caller checks deployBlockers. */
export function publishTemplate(id: string) {
	replace(id, (current) => ({
		...current,
		status: "published",
		version:
			current.status === "published" ? current.version + 1 : current.version,
		updatedAt: "Just now",
	}));
}

export function unpublishTemplate(id: string) {
	replace(id, (current) => ({
		...current,
		status: "draft",
		updatedAt: "Just now",
	}));
}

export function archiveTemplate(id: string) {
	replace(id, (current) => ({
		...current,
		status: "archived",
		updatedAt: "Just now",
	}));
}

/**
 * Make an editable copy in the active org. User-facing copy calls this
 * "customize"; lineage is recorded as "Based on X".
 */
export function forkTemplate(id: string): Template | null {
	const source = store.get().find((template) => template.id === id);
	if (!source) return null;
	const copy: Template = {
		...source,
		id: crypto.randomUUID(),
		name: `${source.name} (copy)`,
		slug: `${source.slug}-copy`,
		official: false,
		origin: "fork",
		status: "draft",
		version: 1,
		serverCount: 0,
		updatedAt: "Just now",
		parentName: source.name,
		images: source.images.map((image) => ({
			...image,
			id: crypto.randomUUID(),
		})),
		variables: source.variables.map((variable) => ({
			...variable,
			id: crypto.randomUUID(),
		})),
	};
	store.set([copy, ...store.get()]);
	return copy;
}

/**
 * Stub import: lands a near-empty draft the operator then fills in. A real
 * import parses a Pterodactyl/Pelican egg; here we only lift a name if one is
 * obvious, so the flow (import → land a draft → open the editor) is exercised.
 */
export function importTemplate(
	name: string,
	opts?: { official?: boolean }
): Template {
	return createTemplate(
		{
			name: name.trim() || "Imported template",
			summary: "",
			description: "",
			category: "Other",
			iconUrl: null,
			images: [],
			variables: [],
			startupCommand: "",
			stopType: "command",
			stopValue: "stop",
			doneMarkers: [],
			installScript: "",
			installContainerImage: "",
			installEntrypoint: "bash",
			features: [],
		},
		opts
	);
}

/**
 * Delete a template. Refused while servers still reference it (archive instead),
 * mirroring the eventual server-side guard. Returns the live server count.
 */
export function deleteTemplate(id: string): { ok: boolean; refCount: number } {
	const target = store.get().find((template) => template.id === id);
	if (target && target.serverCount > 0) {
		return { ok: false, refCount: target.serverCount };
	}
	store.set(store.get().filter((template) => template.id !== id));
	return { ok: true, refCount: 0 };
}
