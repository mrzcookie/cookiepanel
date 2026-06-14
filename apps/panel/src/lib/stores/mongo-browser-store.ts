import type {
	MongoCollection,
	MongoData,
	MongoDocument,
} from "@/lib/domain/mongo-browser";
import { createStore } from "@/lib/store";

// Mutable client-side stub store for the MongoDB Document Browser — a stand-in
// for what the daemon would read from the live instance. Keyed by server: each
// starts from one demo dataset (DEFAULT_DATA) and gets its own copy on first
// change. Browser-only; SSR + the first client render see the shared default.

const MiB = 1024 ** 2;

function doc(id: string, body: Record<string, unknown>): MongoDocument {
	return { id, json: JSON.stringify({ _id: id, ...body }, null, 2) };
}

const DEFAULT_DATA: MongoData = {
	databases: [
		{
			name: "app",
			collections: [
				{
					name: "users",
					documents: 18_342,
					sizeBytes: 12 * MiB,
					indexes: 4,
					sample: [
						doc("665f1a2b3c4d5e6f70811001", {
							email: "jane@example.com",
							name: "Jane Cooper",
							role: "admin",
							createdAt: "2026-03-14T09:12:00Z",
						}),
						doc("665f1a2b3c4d5e6f70811002", {
							email: "amir@example.com",
							name: "Amir Khan",
							role: "member",
							createdAt: "2026-04-02T16:40:00Z",
						}),
					],
				},
				{
					name: "orders",
					documents: 92_750,
					sizeBytes: 64 * MiB,
					indexes: 3,
					sample: [
						doc("665f1a2b3c4d5e6f70822001", {
							userId: "665f1a2b3c4d5e6f70811001",
							totalCents: 4299,
							status: "shipped",
							items: 3,
						}),
					],
				},
				{
					name: "products",
					documents: 1_280,
					sizeBytes: 2 * MiB,
					indexes: 2,
					sample: [
						doc("665f1a2b3c4d5e6f70833001", {
							sku: "CKP-TEE-01",
							name: "Cookie Tee",
							priceCents: 2400,
							tags: ["apparel", "new"],
						}),
					],
				},
			],
		},
		{
			name: "events",
			collections: [
				{
					name: "page_views",
					documents: 5_120_440,
					sizeBytes: 820 * MiB,
					indexes: 3,
					sample: [
						doc("665f1a2b3c4d5e6f70844001", {
							path: "/servers",
							userId: "665f1a2b3c4d5e6f70811001",
							ts: "2026-06-13T11:02:14Z",
						}),
					],
				},
				{
					name: "clicks",
					documents: 1_240_880,
					sizeBytes: 210 * MiB,
					indexes: 2,
					sample: [
						doc("665f1a2b3c4d5e6f70855001", {
							target: "deploy-server",
							path: "/servers/new",
							ts: "2026-06-13T11:03:09Z",
						}),
					],
				},
			],
		},
		{ name: "sessions", collections: [] },
	],
};

// Keyed by server: each server gets its own copy on its first change; everyone
// else reads the shared DEFAULT_DATA. The whole map is one store value, and the
// per-server hook selects its slice (so a server's view only re-renders when its
// own data changes).
const store = createStore<Map<string, MongoData>>(new Map());

function snapshot(serverId: string): MongoData {
	return store.get().get(serverId) ?? DEFAULT_DATA;
}

export function useMongoData(serverId: string): MongoData {
	return store.useWith((byServer) => byServer.get(serverId) ?? DEFAULT_DATA);
}

function mutate(serverId: string, next: (data: MongoData) => MongoData) {
	const byServer = new Map(store.get());
	byServer.set(serverId, next(snapshot(serverId)));
	store.set(byServer);
}

function patchCollection(
	data: MongoData,
	databaseName: string,
	collectionName: string,
	next: (collection: MongoCollection) => MongoCollection
): MongoData {
	return {
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						collections: database.collections.map((collection) =>
							collection.name === collectionName ? next(collection) : collection
						),
					}
				: database
		),
	};
}

// — Databases —————————————————————————————————————————————————————————————————

export function createDatabase(serverId: string, name: string) {
	mutate(serverId, (data) => ({
		...data,
		databases: [...data.databases, { name: name.trim(), collections: [] }],
	}));
}

export function dropDatabase(serverId: string, name: string) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.filter((database) => database.name !== name),
	}));
}

// — Collections ———————————————————————————————————————————————————————————————

export function createCollection(
	serverId: string,
	databaseName: string,
	name: string
) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						collections: [
							...database.collections,
							{
								name: name.trim(),
								documents: 0,
								sizeBytes: 4 * 1024,
								indexes: 1,
								sample: [],
							},
						],
					}
				: database
		),
	}));
}

export function dropCollection(
	serverId: string,
	databaseName: string,
	name: string
) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						collections: database.collections.filter(
							(collection) => collection.name !== name
						),
					}
				: database
		),
	}));
}

// — Documents —————————————————————————————————————————————————————————————————

export function insertDocument(
	serverId: string,
	databaseName: string,
	collectionName: string,
	document: MongoDocument
) {
	mutate(serverId, (data) =>
		patchCollection(data, databaseName, collectionName, (collection) => ({
			...collection,
			documents: collection.documents + 1,
			sample: [document, ...collection.sample],
		}))
	);
}

export function deleteDocument(
	serverId: string,
	databaseName: string,
	collectionName: string,
	id: string
) {
	mutate(serverId, (data) =>
		patchCollection(data, databaseName, collectionName, (collection) => ({
			...collection,
			documents: Math.max(0, collection.documents - 1),
			sample: collection.sample.filter((document) => document.id !== id),
		}))
	);
}
