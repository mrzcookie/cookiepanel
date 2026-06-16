// MongoDB "Document Browser" domain types + pure helpers. The Mongo face of the
// single `database:browser` add-on (engine resolved via databaseEngine()):
// browse databases, collections, and documents, and create/drop them. Types
// only — stub data lives in `mongo-browser-store.ts`.

export type MongoDocument = {
	/** The document `_id`. */
	id: string;
	/** A pretty-printed JSON view of the document. */
	json: string;
};

export type MongoCollection = {
	name: string;
	documents: number;
	sizeBytes: number;
	indexes: number;
	/** A handful of documents for preview. */
	sample: MongoDocument[];
};

export type MongoDatabase = {
	name: string;
	collections: MongoCollection[];
};

export type MongoData = {
	databases: MongoDatabase[];
};

// Database/collection names: no metacharacters (mirrors the daemon's allowlist).
export const MONGO_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function isValidMongoName(value: string): boolean {
	return MONGO_NAME.test(value.trim());
}

export function databaseSize(database: MongoDatabase): number {
	return database.collections.reduce(
		(sum, collection) => sum + collection.sizeBytes,
		0
	);
}
