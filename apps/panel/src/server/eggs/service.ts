import type { Egg, EggImage, EggVariable } from "@/lib/domain/eggs";
import { recordActivity } from "@/server/activity/record";
import { type EggImportResult, fetchEggJson, parseEgg } from "./egg-import";
import {
	type EggImageRecord,
	type EggRecord,
	type EggValues,
	type EggVariableRecord,
	eggsRepository,
	type ImageValues,
	type OwnerScope,
} from "./repository";
import { type EggInputParsed, eggInputSchema, uniqueSlug } from "./validation";

/**
 * Eggs service — the business logic shared by the org surface
 * (`server/eggs`) and the admin/official surface (`server/admin/eggs`).
 * It takes a *verified* `OwnerScope` + `Actor` (resolved from the session by the
 * thin server-fn shims, never the client) and:
 *  - projects DB rows to the client-safe `Egg`, blanking raw image strings
 *    outside the write-gated editor (eggs-over-images, security.md);
 *  - mints collision-free slugs, runs the publish guard, and audits every write.
 * No `createServerFn` here; that stays in the two index files.
 */

/** Who is acting — for the audit trail. `orgId` is null for the official library. */
export type Actor = {
	userId: string;
	userName: string | null;
	orgId: string | null;
};

const DATE = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
});

// ─── projection ──────────────────────────────────────────────────────────────

function toImage(record: EggImageRecord, withImage: boolean): EggImage {
	return {
		id: record.id,
		label: record.label,
		// Server-only outside the editor: the consumer view never carries the raw ref.
		image: withImage ? record.image : "",
		isDefault: record.isDefault,
	};
}

function toVariable(record: EggVariableRecord): EggVariable {
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		envVariable: record.envVariable,
		// A secret's value is per-server + write-only; never reads back.
		defaultValue: record.access === "secret" ? null : record.defaultValue,
		type: record.type,
		required: record.required,
		options: record.options,
		access: record.access,
	};
}

function toEgg(
	record: EggRecord,
	images: EggImageRecord[],
	variables: EggVariableRecord[],
	withImage: boolean
): Egg {
	return {
		id: record.id,
		name: record.name,
		slug: record.slug,
		summary: record.summary,
		description: record.description,
		category: record.category,
		iconUrl: record.iconUrl,
		official: record.organizationId === null,
		origin: record.origin,
		status: record.status,
		version: record.version,
		// Derived from servers (daemon-owned, not wired yet) — 0 until then.
		serverCount: 0,
		updatedAt: DATE.format(record.updatedAt),
		parentName: record.parentName,
		images: images.map((image) => toImage(image, withImage)),
		variables: variables.map(toVariable),
		startupCommand: record.startupCommand,
		stopType: record.stopType,
		stopValue: record.stopValue,
		doneMarkers: record.doneMarkers,
		installScript: record.installScript,
		installContainerImage: record.installContainerImage,
		installEntrypoint: record.installEntrypoint,
		features: record.features,
		configFiles: record.configFiles,
	};
}

/** Group child rows by their eggId (preserving the repo's sort order). */
function groupBy<T extends { eggId: string }>(rows: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>();
	for (const row of rows) {
		const list = map.get(row.eggId);
		if (list) {
			list.push(row);
		} else {
			map.set(row.eggId, [row]);
		}
	}
	return map;
}

// ─── reads ───────────────────────────────────────────────────────────────────

/** The catalog list for a scope — consumer view (raw image strings stripped). */
export async function listEggs(scope: OwnerScope): Promise<Egg[]> {
	const records = await eggsRepository.list(scope);
	const ids = records.map((record) => record.id);
	const [images, variables] = await Promise.all([
		eggsRepository.imagesFor(ids),
		eggsRepository.variablesFor(ids),
	]);
	const imagesById = groupBy(images);
	const variablesById = groupBy(variables);
	return records.map((record) =>
		toEgg(
			record,
			imagesById.get(record.id) ?? [],
			variablesById.get(record.id) ?? [],
			false
		)
	);
}

/**
 * The full editor view of an owned egg — raw image strings included. Null
 * when it isn't owned by the scope (missing and forbidden look identical).
 */
export async function getEditableEgg(
	scope: OwnerScope,
	id: string
): Promise<Egg | null> {
	const record = await eggsRepository.findOwned(scope, id);
	if (!record) {
		return null;
	}
	const [images, variables] = await Promise.all([
		eggsRepository.imagesFor([id]),
		eggsRepository.variablesFor([id]),
	]);
	return toEgg(record, images, variables, true);
}

// ─── input → row helpers ─────────────────────────────────────────────────────

/** Guarantee exactly one default runtime survives to the DB. */
function toImageValues(input: EggInputParsed): ImageValues[] {
	if (input.images.length === 0) {
		return [];
	}
	const hasDefault = input.images.some((image) => image.isDefault);
	return input.images.map((image, index) => ({
		label: image.label,
		image: image.image,
		isDefault: image.isDefault || (!hasDefault && index === 0),
	}));
}

function toVariableValues(input: EggInputParsed) {
	return input.variables.map((variable) => ({
		name: variable.name,
		description: variable.description,
		envVariable: variable.envVariable,
		// Secrets are write-only per-server; an egg never stores a value.
		defaultValue: variable.access === "secret" ? null : variable.defaultValue,
		type: variable.type,
		required: variable.required,
		options: variable.options,
		access: variable.access,
	}));
}

function eggColumns(
	input: EggInputParsed,
	slug: string
): Omit<EggValues, "origin" | "status" | "version" | "parentName"> {
	return {
		name: input.name,
		slug,
		summary: input.summary,
		description: input.description,
		category: input.category,
		iconUrl: input.iconUrl,
		startupCommand: input.startupCommand,
		stopType: input.stopType,
		stopValue: input.stopValue,
		doneMarkers: input.doneMarkers,
		installScript: input.installScript,
		installContainerImage: input.installContainerImage,
		installEntrypoint: input.installEntrypoint,
		features: input.features,
		configFiles: input.configFiles,
	};
}

/** The origin recorded for a freshly-created egg. */
function originFor(
	scope: OwnerScope,
	kind: "scratch" | "import" | "fork"
): EggRecord["origin"] {
	// An official egg always reads as "Official", whatever the entry path.
	return scope.kind === "official" ? "official" : kind;
}

// ─── writes ──────────────────────────────────────────────────────────────────

async function insertEgg(
	scope: OwnerScope,
	actor: Actor,
	input: EggInputParsed,
	opts: {
		origin: EggRecord["origin"];
		parentName: string | null;
		slugSeed?: string;
		action: string;
	}
): Promise<{ id: string; name: string }> {
	const taken = await eggsRepository.listSlugs(scope);
	const slug = uniqueSlug(opts.slugSeed ?? input.name, taken);
	const record = await eggsRepository.create(
		scope,
		{
			...eggColumns(input, slug),
			origin: opts.origin,
			status: "draft",
			version: 1,
			parentName: opts.parentName,
		},
		toImageValues(input),
		toVariableValues(input)
	);
	await audit(actor, opts.action, record);
	return { id: record.id, name: record.name };
}

/** Create a draft from editor input. */
export function createEgg(
	scope: OwnerScope,
	actor: Actor,
	input: EggInputParsed
): Promise<{ id: string; name: string }> {
	return insertEgg(scope, actor, input, {
		origin: originFor(scope, "scratch"),
		parentName: null,
		action: "egg.created",
	});
}

/** Apply editor input to an owned egg (full rewrite of its children). */
export async function updateEgg(
	scope: OwnerScope,
	actor: Actor,
	id: string,
	input: EggInputParsed
): Promise<{ ok: true } | null> {
	const owned = await eggsRepository.findOwned(scope, id);
	if (!owned) {
		return null;
	}
	const taken = await eggsRepository.listSlugs(scope);
	const slug = uniqueSlug(input.name, taken, owned.slug);
	// One transaction: fields + runtimes + variables, so a save never half-applies.
	const updated = await eggsRepository.applyEdit(
		scope,
		id,
		eggColumns(input, slug),
		toImageValues(input),
		toVariableValues(input)
	);
	if (!updated) {
		return null;
	}
	await audit(actor, "egg.updated", owned);
	return { ok: true };
}

/** Plain-language reasons an egg can't be published — the server backstop. */
async function publishBlockers(record: EggRecord): Promise<string[]> {
	const blockers: string[] = [];
	if (!record.name.trim()) {
		blockers.push("name");
	}
	if (!record.startupCommand.trim()) {
		blockers.push("startup command");
	}
	const images = await eggsRepository.imagesFor([record.id]);
	if (images.length === 0) {
		blockers.push("runtime");
	}
	return blockers;
}

/** Publish (or re-publish, bumping the version). Throws if not yet deployable. */
export async function publishEgg(
	scope: OwnerScope,
	actor: Actor,
	id: string
): Promise<{ ok: true; version: number } | null> {
	const owned = await eggsRepository.findOwned(scope, id);
	if (!owned) {
		return null;
	}
	const blockers = await publishBlockers(owned);
	if (blockers.length > 0) {
		throw new Error(`Can't publish yet — missing: ${blockers.join(", ")}.`);
	}
	const version =
		owned.status === "published" ? owned.version + 1 : owned.version;
	await eggsRepository.update(scope, id, { status: "published", version });
	await audit(actor, "egg.published", owned);
	return { ok: true, version };
}

/** Move an egg back to draft (from published or archived). */
export async function unpublishEgg(
	scope: OwnerScope,
	actor: Actor,
	id: string
): Promise<{ ok: true } | null> {
	const owned = await eggsRepository.findOwned(scope, id);
	if (!owned) {
		return null;
	}
	await eggsRepository.update(scope, id, { status: "draft" });
	await audit(actor, "egg.unpublished", owned);
	return { ok: true };
}

/** Take an egg out of the catalog (existing servers unaffected). */
export async function archiveEgg(
	scope: OwnerScope,
	actor: Actor,
	id: string
): Promise<{ ok: true } | null> {
	const owned = await eggsRepository.findOwned(scope, id);
	if (!owned) {
		return null;
	}
	await eggsRepository.update(scope, id, { status: "archived" });
	await audit(actor, "egg.archived", owned);
	return { ok: true };
}

/**
 * Make an editable copy in the active org ("Customize"). The source need only be
 * *visible* (an org's own, or a published official) — single-level lineage is
 * recorded by the parent's name. Org surface only.
 */
export async function forkEgg(
	orgId: string,
	actor: Actor,
	sourceId: string
): Promise<{ id: string; name: string } | null> {
	const scope: OwnerScope = { kind: "org", orgId };
	const source = await eggsRepository.findVisible(scope, sourceId);
	if (!source) {
		return null;
	}
	const [images, variables] = await Promise.all([
		eggsRepository.imagesFor([sourceId]),
		eggsRepository.variablesFor([sourceId]),
	]);
	const input = eggInputSchema.parse({
		...toEgg(source, images, variables, true),
		name: `${source.name} (copy)`,
	});
	return insertEgg(scope, actor, input, {
		origin: "fork",
		parentName: source.name,
		slugSeed: `${source.slug}-copy`,
		action: "egg.forked",
	});
}

/** Import a draft from already-parsed egg/our-format JSON. */
export async function importParsed(
	scope: OwnerScope,
	actor: Actor,
	parsed: EggImportResult
): Promise<{ id: string; name: string; warnings: string[] }> {
	const input = eggInputSchema.parse(parsed.input);
	const created = await insertEgg(scope, actor, input, {
		origin: originFor(scope, "import"),
		parentName: null,
		action: "egg.imported",
	});
	return { ...created, warnings: parsed.warnings };
}

/** Import from pasted/uploaded JSON text. */
export function importEggFromJson(
	scope: OwnerScope,
	actor: Actor,
	json: unknown
): Promise<{ id: string; name: string; warnings: string[] }> {
	return importParsed(scope, actor, parseEgg(json));
}

/** Import from a public https URL (SSRF-guarded fetch). */
export async function importEggFromUrl(
	scope: OwnerScope,
	actor: Actor,
	url: string
): Promise<{ id: string; name: string; warnings: string[] }> {
	const raw = await fetchEggJson(url);
	return importParsed(scope, actor, parseEgg(raw));
}

/**
 * Delete an egg. Refused while servers still reference it (archive instead).
 * Servers are daemon-owned and unwired, so the count is 0 today — the guard is
 * kept so the contract is right when they land.
 */
export async function deleteEgg(
	scope: OwnerScope,
	actor: Actor,
	id: string
): Promise<{ ok: boolean; refCount: number } | null> {
	const owned = await eggsRepository.findOwned(scope, id);
	if (!owned) {
		return null;
	}
	const refCount = 0;
	if (refCount > 0) {
		return { ok: false, refCount };
	}
	const removed = await eggsRepository.remove(scope, id);
	if (!removed) {
		return null;
	}
	await audit(actor, "egg.deleted", owned);
	return { ok: true, refCount: 0 };
}

// ─── audit ───────────────────────────────────────────────────────────────────

function audit(actor: Actor, action: string, record: EggRecord) {
	return recordActivity({
		category: "egg",
		action,
		// Null for the official library (a platform-level action), matching the
		// admin org-delete convention.
		organizationId: actor.orgId,
		userId: actor.userId,
		actorName: actor.userName,
		targetType: "egg",
		targetId: record.id,
		targetLabel: record.name,
	});
}
