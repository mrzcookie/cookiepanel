import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type {
	MongoCollection,
	MongoDatabase,
	MongoDocumentPage,
} from "@/lib/domain/mongo-browser";
import type { DaemonRead } from "@/lib/domain/nodes";
import {
	createMongoCollection as createMongoCollectionFn,
	deleteMongoDocument as deleteMongoDocumentFn,
	dropMongoCollection as dropMongoCollectionFn,
	dropMongoDatabase as dropMongoDatabaseFn,
	getMongoCollections as getMongoCollectionsFn,
	getMongoDatabases as getMongoDatabasesFn,
	getMongoDocuments as getMongoDocumentsFn,
	insertMongoDocument as insertMongoDocumentFn,
} from "@/server/mongo-browser";

// Query factories + hooks + mutation wrappers for the Mongo browser. Reads degrade
// to `{ ok: false }` offline. Keyed under `["mongo", serverId, …]` so one
// invalidation refreshes a server's views (after a create/drop/insert/delete).

export function mongoDatabasesQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["mongo", serverId, "databases"] as const,
		queryFn: () => getMongoDatabasesFn({ data: { serverId } }),
		retry: false,
		staleTime: 5_000,
	});
}

export function useMongoDatabases(
	serverId: string
): DaemonRead<MongoDatabase[]> | undefined {
	return useQuery(mongoDatabasesQueryOptions(serverId)).data;
}

export function mongoCollectionsQueryOptions(serverId: string, db: string) {
	return queryOptions({
		queryKey: ["mongo", serverId, "collections", db] as const,
		queryFn: () => getMongoCollectionsFn({ data: { serverId, db } }),
		retry: false,
		staleTime: 5_000,
	});
}

export function useMongoCollections(
	serverId: string,
	db: string
): DaemonRead<MongoCollection[]> | undefined {
	return useQuery(mongoCollectionsQueryOptions(serverId, db)).data;
}

export function mongoDocumentsQueryOptions(
	serverId: string,
	db: string,
	collection: string,
	skip: number,
	limit: number
) {
	return queryOptions({
		queryKey: [
			"mongo",
			serverId,
			"documents",
			db,
			collection,
			skip,
			limit,
		] as const,
		queryFn: () =>
			getMongoDocumentsFn({ data: { serverId, db, collection, skip, limit } }),
		retry: false,
	});
}

export function useMongoDocuments(
	serverId: string,
	db: string,
	collection: string,
	skip: number,
	limit: number
): DaemonRead<MongoDocumentPage> | undefined {
	return useQuery(
		mongoDocumentsQueryOptions(serverId, db, collection, skip, limit)
	).data;
}

// ─── mutations ───────────────────────────────────────────────────────────────

export function insertMongoDocument(
	serverId: string,
	db: string,
	collection: string,
	doc: string
) {
	return insertMongoDocumentFn({ data: { serverId, db, collection, doc } });
}

export function deleteMongoDocument(
	serverId: string,
	db: string,
	collection: string,
	id: string
) {
	return deleteMongoDocumentFn({ data: { serverId, db, collection, id } });
}

export function createMongoCollection(
	serverId: string,
	db: string,
	collection: string
) {
	return createMongoCollectionFn({ data: { serverId, db, collection } });
}

export function dropMongoCollection(
	serverId: string,
	db: string,
	collection: string
) {
	return dropMongoCollectionFn({ data: { serverId, db, collection } });
}

export function dropMongoDatabase(serverId: string, db: string) {
	return dropMongoDatabaseFn({ data: { serverId, db } });
}

/** Refresh every Mongo view for a server (after any mutation). */
export function invalidateMongo(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["mongo", serverId] });
}
