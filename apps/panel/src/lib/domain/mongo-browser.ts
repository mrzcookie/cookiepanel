import type { components } from "@raptorpanel/contract";

// MongoDB "Browser" domain: the panel-facing types are the generated contract
// schemas (the daemon's wire shapes), plus a name validator. The Mongo face of
// the single `database:browser` add-on (engine resolved via databaseEngine()).

type S = components["schemas"];
export type MongoDatabase = S["MongoDatabase"];
export type MongoCollection = S["MongoCollection"];
export type MongoDocumentPage = S["MongoDocumentPage"];

// Database/collection names: no metacharacters (mirrors the daemon's allowlist).
export const MONGO_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isValidMongoName(value: string): boolean {
	return MONGO_NAME.test(value.trim());
}
