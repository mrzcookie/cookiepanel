// Egg domain types + pure, client-safe helpers.
//
// An Egg is Raptor's "egg": a deployable recipe for a game server or
// app — friendly variables, one or more runtime images, a startup command, and
// an optional install script. Users pick Eggs, never raw Docker image
// strings: an image lives on a *runtime* and is an authoring detail, surfaced
// only inside the editor (write-gated), never on the catalog or a server.
//
// This module is pure (no data, no React). The data layer lives under
// `server/eggs`, surfaced to the UI via `lib/eggs-queries.ts`.

// ─── Enums ───────────────────────────────────────────────────────────────────

export const EGG_CATEGORIES = [
	"Minecraft",
	"Survival",
	"Sandbox",
	"FPS",
	"Voice",
	"App",
	"Database",
	"Other",
] as const;
export type EggCategory = (typeof EGG_CATEGORIES)[number];

/** How an egg came to exist (provenance, for the UI). */
export type EggOrigin = "official" | "scratch" | "import" | "fork";

export type EggStatus = "draft" | "published" | "archived";

export const ORIGIN_LABELS: Record<EggOrigin, string> = {
	official: "Official",
	scratch: "From scratch",
	import: "Imported",
	fork: "Customized",
};

/**
 * How a running server is asked to stop:
 * - `command`: write a line to the console (e.g. `stop`)
 * - `signal`: send an OS signal (e.g. `SIGINT`)
 * - `native`: let the container's own stop handling take over
 */
export const STOP_TYPES = ["command", "signal", "native"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** Shell the install script runs under, inside the throwaway install container. */
export const INSTALL_ENTRYPOINTS = ["bash", "ash", "sh"] as const;
export type InstallEntrypoint = (typeof INSTALL_ENTRYPOINTS)[number];

// ─── Config files ────────────────────────────────────────────────────────────
// Managed config files the daemon merges into a server's data volume at deploy
// (the panel resolves {{TOKEN}} values first). `parser` picks the in-place merge
// strategy; `replace` maps a (possibly dotted) key to a value-with-tokens.

export const CONFIG_PARSERS = [
	"properties",
	"ini",
	"json",
	"yaml",
	"file",
] as const;
export type ConfigParser = (typeof CONFIG_PARSERS)[number];

export type EggConfigFile = {
	/** Path within the server's data volume, e.g. "server.properties". */
	file: string;
	parser: ConfigParser;
	/** key → value (values may contain {{VAR}} / {{SERVER_PORT}} tokens). */
	replace: Record<string, string>;
};

// ─── Variables (authoring form) ──────────────────────────────────────────────
// Authors pick a friendly "type" + a single access choice; the real schema's
// Laravel-style rule strings are an implementation detail we don't expose here.

export const VARIABLE_TYPES = ["text", "number", "toggle", "select"] as const;
export type VariableType = (typeof VARIABLE_TYPES)[number];

export const VARIABLE_TYPE_LABELS: Record<VariableType, string> = {
	text: "Text",
	number: "Number",
	toggle: "On / off",
	select: "Choice",
};

/** Mutually-exclusive access state shown as the variable's row chip. */
export const VARIABLE_ACCESSES = [
	"editable",
	"read-only",
	"hidden",
	"secret",
] as const;
export type VariableAccess = (typeof VARIABLE_ACCESSES)[number];

export const VARIABLE_ACCESS_LABELS: Record<VariableAccess, string> = {
	editable: "Editable",
	"read-only": "Read-only",
	hidden: "Hidden",
	secret: "Secret",
};

export const VARIABLE_ACCESS_HINTS: Record<VariableAccess, string> = {
	editable: "Players can change it",
	"read-only": "Visible, not editable",
	hidden: "Not shown to players",
	secret: "Encrypted, never shown",
};

/** The form control a variable renders as, derived from its type + access. */
export type VariableControl =
	| { kind: "text" }
	| { kind: "number" }
	| { kind: "toggle" }
	| { kind: "select"; options: string[] }
	| { kind: "secret" };

export function controlForVariable(v: {
	type: VariableType;
	options: string[];
	access: VariableAccess;
}): VariableControl {
	if (v.access === "secret") return { kind: "secret" };
	switch (v.type) {
		case "toggle":
			return { kind: "toggle" };
		case "select":
			return { kind: "select", options: v.options };
		case "number":
			return { kind: "number" };
		default:
			return { kind: "text" };
	}
}

// ─── Startup ─────────────────────────────────────────────────────────────────

/** A line in the server log that signals "ready to play". */
export type DoneMatcher =
	| { kind: "string"; value: string }
	| { kind: "regex"; pattern: string };

// ─── Add-ons (features) ──────────────────────────────────────────────────────

/** A declared capability that unlocks an extra panel module on built servers. */
export type EggFeature = { key: string };

/** Plain-language metadata for the capabilities the panel ships a module for. */
export const FEATURE_METADATA: Record<
	string,
	{ label: string; description: string }
> = {
	"minecraft:eula": {
		label: "EULA helper",
		description: "Prompts to accept the Minecraft EULA before first start.",
	},
	"minecraft:bukkit-plugins": {
		label: "Plugin installer",
		description: "Browse and install Bukkit, Spigot, and Paper plugins.",
	},
	"minecraft:mods": {
		label: "Mod manager",
		description: "Install Forge and Fabric mods.",
	},
	"steam:gslt": {
		label: "Steam login token",
		description: "Set a Game Server Login Token.",
	},
	"database:browser": {
		label: "Browser",
		description:
			"Browse and manage the database — its tables or collections, users, and data. Works with PostgreSQL, MySQL, MariaDB, Redis, and MongoDB.",
	},
};

// ─── Database Browser add-on ─────────────────────────────────────────────────
// One add-on for every database. Enabling it (in the egg's Add-ons tab)
// puts a "Browser" tab on every server built from the egg; the browser
// detects the database type and adapts (SQL tables, Redis keys, Mongo docs).

export const DATABASE_BROWSER_FEATURE = "database:browser";

export type DatabaseEngine = "sql" | "redis" | "mongo";

/** Whether an egg enables the Browser add-on. */
export function hasDatabaseBrowser(features: EggFeature[]): boolean {
	return features.some((feature) => feature.key === DATABASE_BROWSER_FEATURE);
}

/** The Browser tab's label. */
export const DATABASE_BROWSER_LABEL =
	FEATURE_METADATA[DATABASE_BROWSER_FEATURE]?.label ?? "Browser";

/**
 * Detect the database engine from the egg's identity so the single Browser
 * add-on can adapt itself to the database it's managing.
 */
export function databaseEngine(egg: {
	name: string;
	slug: string;
}): DatabaseEngine {
	const text = `${egg.slug} ${egg.name}`.toLowerCase();
	if (text.includes("redis")) {
		return "redis";
	}
	if (text.includes("mongo")) {
		return "mongo";
	}
	return "sql";
}

// ─── Data shapes ─────────────────────────────────────────────────────────────

/**
 * One runtime players can pick. `image` (the raw Docker reference) is an
 * authoring-only detail: shown in the editor, never on the catalog or a server.
 */
export type EggImage = {
	id: string;
	label: string;
	image: string;
	isDefault: boolean;
};

export type EggVariable = {
	id: string;
	name: string;
	description: string;
	envVariable: string;
	/** Null for secrets (per-server, write-only) and unset defaults. */
	defaultValue: string | null;
	type: VariableType;
	required: boolean;
	options: string[];
	access: VariableAccess;
};

export type Egg = {
	id: string;
	name: string;
	slug: string;
	summary: string;
	description: string;
	category: EggCategory;
	/** Logo/icon for the catalog. A data URL in the UI-first phase (an S3 key
	 *  later); null falls back to the generic egg glyph. */
	iconUrl: string | null;
	/** Derived from ownership: official = platform-owned, read-only to orgs. */
	official: boolean;
	origin: EggOrigin;
	status: EggStatus;
	/** Bumps on re-publish. */
	version: number;
	/** Org servers deployed from this egg (stub linkage). */
	serverCount: number;
	/** Pre-formatted for the UI-first phase. */
	updatedAt: string;
	/** Fork lineage: the parent's name, or null. */
	parentName: string | null;
	// — Authoring detail —
	images: EggImage[];
	variables: EggVariable[];
	startupCommand: string;
	stopType: StopType;
	stopValue: string;
	doneMarkers: DoneMatcher[];
	/** Empty string = no install step. */
	installScript: string;
	installContainerImage: string;
	installEntrypoint: InstallEntrypoint;
	features: EggFeature[];
	configFiles: EggConfigFile[];
};

/**
 * The author-editable slice of an egg — what the editor produces and the
 * store applies on create/update. Everything else (id, slug, status, version,
 * official, lineage, ack) is managed by the store.
 */
export type EggInput = {
	name: string;
	summary: string;
	description: string;
	category: EggCategory;
	iconUrl: string | null;
	images: Omit<EggImage, "id">[];
	variables: Omit<EggVariable, "id">[];
	startupCommand: string;
	stopType: StopType;
	stopValue: string;
	doneMarkers: DoneMatcher[];
	installScript: string;
	installContainerImage: string;
	installEntrypoint: InstallEntrypoint;
	features: EggFeature[];
	configFiles: EggConfigFile[];
};

// ─── Derived state ───────────────────────────────────────────────────────────

/** Owned (non-official) eggs are editable in the UI-first phase. */
export function isEditable(egg: Egg): boolean {
	return !egg.official;
}

/**
 * Plain-language reasons an egg can't yet be published/deployed. An empty
 * list means it's ready. Mirrors the eventual server-side publish guard.
 */
export function deployBlockers(egg: Egg): string[] {
	const blockers: string[] = [];
	if (!egg.name.trim()) blockers.push("Give the egg a name.");
	if (egg.images.length === 0) {
		blockers.push("Add at least one runtime.");
	}
	if (!egg.startupCommand.trim()) {
		blockers.push("Set a startup command.");
	}
	return blockers;
}

/** A published egg with no blockers can have servers launched from it. */
export function isDeployable(egg: Egg): boolean {
	return egg.status === "published" && deployBlockers(egg).length === 0;
}

/** Only the variables a player fills in when deploying (editable + secret). */
export function deployVariables(egg: Egg): EggVariable[] {
	return egg.variables.filter(
		(v) => v.access === "editable" || v.access === "secret"
	);
}

/** The default runtime (image) label — the one marked default, else the first. */
export function defaultRuntimeLabel(egg: Egg): string {
	return (
		egg.images.find((image) => image.isDefault)?.label ??
		egg.images[0]?.label ??
		""
	);
}

/** The variables shown on the read-only detail page (everything but hidden). */
export function shownVariables(egg: Egg): EggVariable[] {
	return egg.variables.filter((v) => v.access !== "hidden");
}

/** The known capabilities (panel ships a module), projected with labels. */
export function knownFeatures(
	features: EggFeature[]
): { key: string; label: string; description: string }[] {
	return features
		.map((f) => {
			const meta = FEATURE_METADATA[f.key];
			return meta ? { key: f.key, ...meta } : null;
		})
		.filter((f): f is { key: string; label: string; description: string } =>
			Boolean(f)
		);
}
