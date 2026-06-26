import type { components } from "@raptor/contract";

// SQL Browser domain: a lightweight phpMyAdmin for the two SQL engine families
// Raptor ships (PostgreSQL + MySQL/MariaDB). The panel-facing types are the
// generated contract schemas (the daemon's wire shapes); the rest are pure,
// client-safe helpers. The SQL face of the single `database:browser` add-on
// (engine resolved via databaseEngine()).

type S = components["schemas"];
export type SqlDatabase = S["SqlDatabase"];
export type SqlTable = S["SqlTable"];
export type SqlColumn = S["SqlColumn"];
export type SqlUser = S["SqlUser"];

/** The finer SQL engine — `databaseEngine()` only resolves to "sql". */
export type SqlEngine = "postgres" | "mysql";

// Detect Postgres vs MySQL/MariaDB from an egg's friendly name. The daemon
// needs this to pick the driver, container port, and dialect; everything that
// isn't Postgres uses the MySQL driver (MariaDB shares its wire protocol).
export function sqlEngine(text: string): SqlEngine {
	return /postgre/i.test(text) ? "postgres" : "mysql";
}

/** The admin username the engine's official image creates. */
export function sqlAdminUser(engine: SqlEngine): string {
	return engine === "postgres" ? "postgres" : "root";
}

// A safe SQL identifier (no metacharacters), mirroring the daemon's allowlist —
// names are validated up front so nothing can be query-injected.
export const SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidIdentifier(value: string): boolean {
	return SQL_IDENTIFIER.test(value.trim());
}

// CREATE DATABASE character sets (MySQL only; Postgres inherits the egg
// encoding). Mirrors the daemon's allowlist.
export const SQL_CHARSETS = ["utf8mb4", "utf8", "latin1", "ascii"] as const;

const COMMON_COLUMN_TYPES = [
	"bigint",
	"int",
	"varchar(255)",
	"text",
	"boolean",
	"timestamp",
	"numeric",
];

/** The column types offered for an engine (matches the daemon's per-engine set). */
export function columnTypes(engine: SqlEngine): string[] {
	return engine === "postgres"
		? [...COMMON_COLUMN_TYPES, "jsonb", "uuid"]
		: [...COMMON_COLUMN_TYPES, "json"];
}

const COLUMN_KEY_LABEL: Record<string, string> = {
	pk: "Primary",
	unique: "Unique",
	index: "Index",
};

/** The label shown for a column's key role ("" for a plain column). */
export function columnKeyLabel(key: string): string {
	return COLUMN_KEY_LABEL[key] ?? "";
}

/** Plain-language summary of a user's grants for a row readout. */
export function grantsLabel(user: SqlUser): string {
	if (user.superuser || user.grants.includes("*")) {
		return "All databases";
	}
	if (user.grants.length === 0) {
		return "No access";
	}
	return user.grants.join(", ");
}
