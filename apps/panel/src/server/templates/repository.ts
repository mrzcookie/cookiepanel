import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import {
	template,
	templateImage,
	templateVariable,
} from "@/server/db/schema/templates";

export type TemplateRecord = typeof template.$inferSelect;
export type TemplateImageRecord = typeof templateImage.$inferSelect;
export type TemplateVariableRecord = typeof templateVariable.$inferSelect;

/** A new template row, minus the columns the repository assigns itself. */
export type TemplateValues = Omit<
	typeof template.$inferInsert,
	"id" | "organizationId" | "createdAt" | "updatedAt"
>;
/** A child runtime/variable, minus the id + templateId the repository assigns. */
export type ImageValues = Omit<
	typeof templateImage.$inferInsert,
	"id" | "templateId"
>;
export type VariableValues = Omit<
	typeof templateVariable.$inferInsert,
	"id" | "templateId"
>;

export type TemplatePatch = Partial<
	Pick<
		typeof template.$inferInsert,
		| "name"
		| "slug"
		| "summary"
		| "description"
		| "category"
		| "iconUrl"
		| "status"
		| "version"
		| "parentName"
		| "startupCommand"
		| "stopType"
		| "stopValue"
		| "doneMarkers"
		| "installScript"
		| "installContainerImage"
		| "installEntrypoint"
		| "features"
	>
>;

/**
 * Which template scope a caller acts within. An org owns its own templates; the
 * official library is the null-org rows curated under /admin. Every read and
 * write below keys off this, so a row outside the caller's scope is
 * indistinguishable from a missing one — the IDOR backstop from security.md.
 */
export type OwnerScope = { kind: "org"; orgId: string } | { kind: "official" };

/** The owner predicate for a scope (org rows, or the official null-org rows). */
function ownerWhere(scope: OwnerScope) {
	return scope.kind === "official"
		? isNull(template.organizationId)
		: eq(template.organizationId, scope.orgId);
}

/** What a scope is allowed to *see*: own templates (any status), and — for an
 *  org — published official ones too. The official library sees only itself. */
function visibleWhere(scope: OwnerScope) {
	if (scope.kind === "official") {
		return isNull(template.organizationId);
	}
	return or(
		eq(template.organizationId, scope.orgId),
		and(isNull(template.organizationId), eq(template.status, "published"))
	);
}

/**
 * The only module that touches the template tables. The service resolves a
 * verified `OwnerScope` (from the session, never the client) and this layer
 * trusts and scopes by it. Writes mint their own ids and run their child
 * rewrites in a transaction so a template never half-updates.
 */
export const templatesRepository = {
	/** Templates visible to a scope, alphabetical by name (the catalog re-sorts). */
	list: (scope: OwnerScope): Promise<TemplateRecord[]> =>
		db
			.select()
			.from(template)
			.where(visibleWhere(scope))
			.orderBy(asc(template.name)),

	/** A template visible to a scope (own, or published official) — for fork. */
	findVisible: (
		scope: OwnerScope,
		id: string
	): Promise<TemplateRecord | undefined> =>
		db
			.select()
			.from(template)
			.where(and(eq(template.id, id), visibleWhere(scope)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** A template *owned* by a scope — the gate for edit / publish / delete. */
	findOwned: (
		scope: OwnerScope,
		id: string
	): Promise<TemplateRecord | undefined> =>
		db
			.select()
			.from(template)
			.where(and(eq(template.id, id), ownerWhere(scope)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** The slugs a scope already uses (for collision-free slug minting). */
	listSlugs: (scope: OwnerScope): Promise<string[]> =>
		db
			.select({ slug: template.slug })
			.from(template)
			.where(ownerWhere(scope))
			.then((rows) => rows.map((row) => row.slug)),

	/** Images for a set of templates, ordered, for list/detail assembly. */
	imagesFor: (templateIds: string[]): Promise<TemplateImageRecord[]> =>
		templateIds.length === 0
			? Promise.resolve([])
			: db
					.select()
					.from(templateImage)
					.where(inArray(templateImage.templateId, templateIds))
					.orderBy(asc(templateImage.sortOrder)),

	/** Variables for a set of templates, ordered, for list/detail assembly. */
	variablesFor: (templateIds: string[]): Promise<TemplateVariableRecord[]> =>
		templateIds.length === 0
			? Promise.resolve([])
			: db
					.select()
					.from(templateVariable)
					.where(inArray(templateVariable.templateId, templateIds))
					.orderBy(asc(templateVariable.sortOrder)),

	/** Create a template with its runtimes + variables atomically. */
	create: (
		scope: OwnerScope,
		values: TemplateValues,
		images: ImageValues[],
		variables: VariableValues[]
	): Promise<TemplateRecord> =>
		db.transaction(async (tx) => {
			const [row] = await tx
				.insert(template)
				.values({
					...values,
					id: randomUUID(),
					organizationId: scope.kind === "org" ? scope.orgId : null,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create template");
			}
			if (images.length > 0) {
				await tx.insert(templateImage).values(
					images.map((image, index) => ({
						...image,
						id: randomUUID(),
						templateId: row.id,
						sortOrder: index,
					}))
				);
			}
			if (variables.length > 0) {
				await tx.insert(templateVariable).values(
					variables.map((variable, index) => ({
						...variable,
						id: randomUUID(),
						templateId: row.id,
						sortOrder: index,
					}))
				);
			}
			return row;
		}),

	/** Patch a template's own fields, scoped to its owner. */
	update: (
		scope: OwnerScope,
		id: string,
		patch: TemplatePatch
	): Promise<TemplateRecord | undefined> =>
		db
			.update(template)
			.set(patch)
			.where(and(eq(template.id, id), ownerWhere(scope)))
			.returning()
			.then((rows) => rows.at(0)),

	/**
	 * Apply an editor save: patch the template's fields and fully rewrite its
	 * runtimes + variables, all in **one transaction** so a save can never leave a
	 * template half-updated (new fields but stale variables). Owner-scoped — a row
	 * outside the scope updates nothing and returns undefined (the children are
	 * left untouched because the patch runs first).
	 */
	applyEdit: (
		scope: OwnerScope,
		id: string,
		patch: TemplatePatch,
		images: ImageValues[],
		variables: VariableValues[]
	): Promise<TemplateRecord | undefined> =>
		db.transaction(async (tx) => {
			const [row] = await tx
				.update(template)
				.set(patch)
				.where(and(eq(template.id, id), ownerWhere(scope)))
				.returning();
			if (!row) {
				return undefined;
			}
			await tx.delete(templateImage).where(eq(templateImage.templateId, id));
			if (images.length > 0) {
				await tx.insert(templateImage).values(
					images.map((image, index) => ({
						...image,
						id: randomUUID(),
						templateId: id,
						sortOrder: index,
					}))
				);
			}
			await tx
				.delete(templateVariable)
				.where(eq(templateVariable.templateId, id));
			if (variables.length > 0) {
				await tx.insert(templateVariable).values(
					variables.map((variable, index) => ({
						...variable,
						id: randomUUID(),
						templateId: id,
						sortOrder: index,
					}))
				);
			}
			return row;
		}),

	/** Delete a template (children cascade), scoped to its owner. */
	remove: (
		scope: OwnerScope,
		id: string
	): Promise<{ id: string; name: string } | undefined> =>
		db
			.delete(template)
			.where(and(eq(template.id, id), ownerWhere(scope)))
			.returning({ id: template.id, name: template.name })
			.then((rows) => rows.at(0)),
};
