import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db";
import { egg, eggImage, eggVariable } from "@/server/db/schema/eggs";

export type EggRecord = typeof egg.$inferSelect;
export type EggImageRecord = typeof eggImage.$inferSelect;
export type EggVariableRecord = typeof eggVariable.$inferSelect;

/** A new egg row, minus the columns the repository assigns itself. */
export type EggValues = Omit<
	typeof egg.$inferInsert,
	"id" | "organizationId" | "createdAt" | "updatedAt"
>;
/** A child runtime/variable, minus the id + eggId the repository assigns. */
export type ImageValues = Omit<typeof eggImage.$inferInsert, "id" | "eggId">;
export type VariableValues = Omit<
	typeof eggVariable.$inferInsert,
	"id" | "eggId"
>;

export type EggPatch = Partial<
	Pick<
		typeof egg.$inferInsert,
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
		| "configFiles"
	>
>;

/**
 * Which egg scope a caller acts within. An org owns its own eggs; the
 * official library is the null-org rows curated under /admin. Every read and
 * write below keys off this, so a row outside the caller's scope is
 * indistinguishable from a missing one — the IDOR backstop from security.md.
 */
export type OwnerScope = { kind: "org"; orgId: string } | { kind: "official" };

/** The owner predicate for a scope (org rows, or the official null-org rows). */
function ownerWhere(scope: OwnerScope) {
	return scope.kind === "official"
		? isNull(egg.organizationId)
		: eq(egg.organizationId, scope.orgId);
}

/** What a scope is allowed to *see*: own eggs (any status), and — for an
 *  org — published official ones too. The official library sees only itself. */
function visibleWhere(scope: OwnerScope) {
	if (scope.kind === "official") {
		return isNull(egg.organizationId);
	}
	return or(
		eq(egg.organizationId, scope.orgId),
		and(isNull(egg.organizationId), eq(egg.status, "published"))
	);
}

/**
 * The only module that touches the egg tables. The service resolves a
 * verified `OwnerScope` (from the session, never the client) and this layer
 * trusts and scopes by it. Writes mint their own ids and run their child
 * rewrites in a transaction so an egg never half-updates.
 */
export const eggsRepository = {
	/** Eggs visible to a scope, alphabetical by name (the catalog re-sorts). */
	list: (scope: OwnerScope): Promise<EggRecord[]> =>
		db.select().from(egg).where(visibleWhere(scope)).orderBy(asc(egg.name)),

	/** An egg visible to a scope (own, or published official) — for fork. */
	findVisible: (
		scope: OwnerScope,
		id: string
	): Promise<EggRecord | undefined> =>
		db
			.select()
			.from(egg)
			.where(and(eq(egg.id, id), visibleWhere(scope)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** An egg *owned* by a scope — the gate for edit / publish / delete. */
	findOwned: (scope: OwnerScope, id: string): Promise<EggRecord | undefined> =>
		db
			.select()
			.from(egg)
			.where(and(eq(egg.id, id), ownerWhere(scope)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** The slugs a scope already uses (for collision-free slug minting). */
	listSlugs: (scope: OwnerScope): Promise<string[]> =>
		db
			.select({ slug: egg.slug })
			.from(egg)
			.where(ownerWhere(scope))
			.then((rows) => rows.map((row) => row.slug)),

	/** Images for a set of eggs, ordered, for list/detail assembly. */
	imagesFor: (eggIds: string[]): Promise<EggImageRecord[]> =>
		eggIds.length === 0
			? Promise.resolve([])
			: db
					.select()
					.from(eggImage)
					.where(inArray(eggImage.eggId, eggIds))
					.orderBy(asc(eggImage.sortOrder)),

	/** Variables for a set of eggs, ordered, for list/detail assembly. */
	variablesFor: (eggIds: string[]): Promise<EggVariableRecord[]> =>
		eggIds.length === 0
			? Promise.resolve([])
			: db
					.select()
					.from(eggVariable)
					.where(inArray(eggVariable.eggId, eggIds))
					.orderBy(asc(eggVariable.sortOrder)),

	/** Create an egg with its runtimes + variables atomically. */
	create: (
		scope: OwnerScope,
		values: EggValues,
		images: ImageValues[],
		variables: VariableValues[]
	): Promise<EggRecord> =>
		db.transaction(async (tx) => {
			const [row] = await tx
				.insert(egg)
				.values({
					...values,
					id: randomUUID(),
					organizationId: scope.kind === "org" ? scope.orgId : null,
				})
				.returning();
			if (!row) {
				throw new Error("Failed to create egg");
			}
			if (images.length > 0) {
				await tx.insert(eggImage).values(
					images.map((image, index) => ({
						...image,
						id: randomUUID(),
						eggId: row.id,
						sortOrder: index,
					}))
				);
			}
			if (variables.length > 0) {
				await tx.insert(eggVariable).values(
					variables.map((variable, index) => ({
						...variable,
						id: randomUUID(),
						eggId: row.id,
						sortOrder: index,
					}))
				);
			}
			return row;
		}),

	/** Patch an egg's own fields, scoped to its owner. */
	update: (
		scope: OwnerScope,
		id: string,
		patch: EggPatch
	): Promise<EggRecord | undefined> =>
		db
			.update(egg)
			.set(patch)
			.where(and(eq(egg.id, id), ownerWhere(scope)))
			.returning()
			.then((rows) => rows.at(0)),

	/**
	 * Apply an editor save: patch the egg's fields and fully rewrite its
	 * runtimes + variables, all in **one transaction** so a save can never leave a
	 * egg half-updated (new fields but stale variables). Owner-scoped — a row
	 * outside the scope updates nothing and returns undefined (the children are
	 * left untouched because the patch runs first).
	 */
	applyEdit: (
		scope: OwnerScope,
		id: string,
		patch: EggPatch,
		images: ImageValues[],
		variables: VariableValues[]
	): Promise<EggRecord | undefined> =>
		db.transaction(async (tx) => {
			const [row] = await tx
				.update(egg)
				.set(patch)
				.where(and(eq(egg.id, id), ownerWhere(scope)))
				.returning();
			if (!row) {
				return undefined;
			}
			await tx.delete(eggImage).where(eq(eggImage.eggId, id));
			if (images.length > 0) {
				await tx.insert(eggImage).values(
					images.map((image, index) => ({
						...image,
						id: randomUUID(),
						eggId: id,
						sortOrder: index,
					}))
				);
			}
			await tx.delete(eggVariable).where(eq(eggVariable.eggId, id));
			if (variables.length > 0) {
				await tx.insert(eggVariable).values(
					variables.map((variable, index) => ({
						...variable,
						id: randomUUID(),
						eggId: id,
						sortOrder: index,
					}))
				);
			}
			return row;
		}),

	/** Delete an egg (children cascade), scoped to its owner. */
	remove: (
		scope: OwnerScope,
		id: string
	): Promise<{ id: string; name: string } | undefined> =>
		db
			.delete(egg)
			.where(and(eq(egg.id, id), ownerWhere(scope)))
			.returning({ id: egg.id, name: egg.name })
			.then((rows) => rows.at(0)),
};
