import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
	DoneMatcher,
	EggCategory,
	EggConfigFile,
	EggFeature,
	EggOrigin,
	EggStatus,
	InstallEntrypoint,
	StopType,
	VariableAccess,
	VariableType,
} from "@/lib/domain/eggs";
import { organization } from "./auth";

/**
 * Eggs — the panel's "eggs": reusable, deployable recipes for a server.
 * Panel-owned *desired* state, the first richly-relational entity. A egg
 * fans out into two child tables (runtimes + variables) so each is indexed and
 * the security boundary is explicit.
 *
 * **Ownership is the only "official" switch.** `organizationId IS NULL` marks a
 * platform-owned official egg (read-only to every org, curated under
 * /admin/eggs); a non-null org owns and edits its own. The repository keys
 * every read/write off this column — an org sees its own eggs (any status)
 * plus *published* official ones, and never another org's row (the IDOR
 * backstop from security.md).
 *
 * **`image` strings are server-only.** They live on `egg_image.image`; the
 * client only ever receives the friendly `label` outside the write-gated editor
 * (the eggs-over-images promise). The consumer projection blanks `image`.
 *
 * Live linkage (a egg's deployed-server count) is *derived* from servers,
 * which are daemon-owned and don't exist yet — so it isn't stored here; the
 * projection reports 0 until servers are wired.
 */
export const egg = pgTable(
	"egg",
	{
		id: text("id").primaryKey(),
		// null = official (platform-owned, read-only to orgs); else the owning org.
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		name: text("name").notNull(),
		slug: text("slug").notNull(),
		summary: text("summary").notNull().default(""),
		description: text("description").notNull().default(""),
		category: text("category").$type<EggCategory>().notNull().default("Other"),
		// Catalog icon — a data URL today, an S3 key later; null falls back to the
		// generic egg glyph.
		iconUrl: text("icon_url"),
		origin: text("origin").$type<EggOrigin>().notNull(),
		status: text("status").$type<EggStatus>().notNull().default("draft"),
		// Bumps only on re-publish of an already-published egg.
		version: integer("version").notNull().default(1),
		// Fork lineage: the parent's display name ("Based on X"), or null. A name,
		// not an FK — the parent may be official, deleted, or in another scope.
		parentName: text("parent_name"),
		// Startup command with {{VAR}} tokens; resolved on the box only.
		startupCommand: text("startup_command").notNull().default(""),
		stopType: text("stop_type").$type<StopType>().notNull().default("command"),
		stopValue: text("stop_value").notNull().default("stop"),
		doneMarkers: jsonb("done_markers")
			.$type<DoneMatcher[]>()
			.notNull()
			.default([]),
		// Empty string = no install step.
		installScript: text("install_script").notNull().default(""),
		installContainerImage: text("install_container_image")
			.notNull()
			.default(""),
		installEntrypoint: text("install_entrypoint")
			.$type<InstallEntrypoint>()
			.notNull()
			.default("bash"),
		// Managed config files the daemon merges into the data volume at deploy.
		configFiles: jsonb("config_files")
			.$type<EggConfigFile[]>()
			.notNull()
			.default([]),
		features: jsonb("features").$type<EggFeature[]>().notNull().default([]),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("egg_organization_id_idx").on(table.organizationId),
		index("egg_status_idx").on(table.status),
		// Slug uniqueness within an org. Postgres treats NULLs as distinct, so this
		// does NOT constrain the official (null-org) rows — those get their own
		// partial unique index below.
		uniqueIndex("egg_org_slug_uidx").on(table.organizationId, table.slug),
		uniqueIndex("egg_official_slug_uidx")
			.on(table.slug)
			.where(sql`${table.organizationId} is null`),
	]
);

/**
 * A runtime players can pick (label → image). `image` is **server-only** — the
 * raw Docker reference, surfaced only inside the write-gated editor, never on a
 * catalog/detail/server. Exactly one row per egg should be `isDefault`.
 */
export const eggImage = pgTable(
	"egg_image",
	{
		id: text("id").primaryKey(),
		eggId: text("egg_id")
			.notNull()
			.references(() => egg.id, { onDelete: "cascade" }),
		label: text("label").notNull(),
		image: text("image").notNull(),
		isDefault: boolean("is_default").notNull().default(false),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(table) => [index("egg_image_egg_id_idx").on(table.eggId)]
);

/**
 * A friendly variable a player fills in before a server starts. The author picks
 * a `type` (text / number / toggle / select) and one `access` state (editable /
 * read-only / hidden / secret). A secret's value is per-server and write-only —
 * the egg stores only the declaration, never a value (`defaultValue` null).
 */
export const eggVariable = pgTable(
	"egg_variable",
	{
		id: text("id").primaryKey(),
		eggId: text("egg_id")
			.notNull()
			.references(() => egg.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description").notNull().default(""),
		envVariable: text("env_variable").notNull(),
		// Null for a secret (per-server, write-only) or an unset default.
		defaultValue: text("default_value"),
		type: text("type").$type<VariableType>().notNull().default("text"),
		required: boolean("required").notNull().default(false),
		options: jsonb("options").$type<string[]>().notNull().default([]),
		access: text("access")
			.$type<VariableAccess>()
			.notNull()
			.default("editable"),
		sortOrder: integer("sort_order").notNull().default(0),
	},
	(table) => [index("egg_variable_egg_id_idx").on(table.eggId)]
);
