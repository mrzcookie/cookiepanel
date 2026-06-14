// SQL Browser domain types + pure, client-safe helpers. The SQL Browser is the
// panel module unlocked by the `database:sql-browser` add-on: a lightweight
// phpMyAdmin for creating databases and users and managing tables. Types only —
// the mutable stub data lives in `sql-browser-store.ts`.

/** A column's role in its table (primary key / unique / indexed / plain). */
export type SqlColumnKey = "pk" | "unique" | "index" | "";

export type SqlColumn = {
	name: string;
	/** A SQL type label, e.g. "bigint", "varchar(255)" — never a raw image. */
	type: string;
	nullable: boolean;
	key: SqlColumnKey;
	/** A default expression as text, or null for none. */
	default: string | null;
};

export type SqlTable = {
	name: string;
	rows: number;
	sizeBytes: number;
	columns: SqlColumn[];
};

export type SqlDatabase = {
	name: string;
	charset: string;
	tables: SqlTable[];
};

export type SqlUser = {
	name: string;
	/** The host pattern the user may connect from ("%" = anywhere). */
	host: string;
	superuser: boolean;
	/** Granted database names; ["*"] = every database. */
	grants: string[];
};

export type SqlData = {
	databases: SqlDatabase[];
	users: SqlUser[];
};

export const SQL_CHARSETS = ["utf8mb4", "utf8", "latin1", "ascii"] as const;

export const SQL_COLUMN_TYPES = [
	"bigint",
	"int",
	"varchar(255)",
	"text",
	"boolean",
	"timestamp",
	"jsonb",
	"uuid",
	"numeric",
] as const;

// A safe SQL identifier (no metacharacters), mirroring the daemon's allowlist —
// names are validated up front so nothing can be shell- or query-injected.
export const SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function isValidIdentifier(value: string): boolean {
	return SQL_IDENTIFIER.test(value.trim());
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

/** The label shown for a column's key role. */
export const COLUMN_KEY_LABEL: Record<SqlColumnKey, string> = {
	pk: "Primary",
	unique: "Unique",
	index: "Index",
	"": "",
};
