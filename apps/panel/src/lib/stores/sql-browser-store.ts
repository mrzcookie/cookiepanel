import type {
	SqlColumn,
	SqlData,
	SqlTable,
	SqlUser,
} from "@/lib/domain/sql-browser";
import { createStore } from "@/lib/store";

// Mutable client-side stub store for the SQL Browser add-on — a stand-in for
// what the daemon would report by introspecting the database. Data is keyed by
// server: every server starts from one demo dataset (DEFAULT_DATA) and gets its
// own copy on the first change, so creating a database on one server doesn't
// touch another. Mutations are browser-only; SSR + the first client render see
// the shared default. Replaced wholesale when the data layer lands.

const MiB = 1024 ** 2;

const DEFAULT_DATA: SqlData = {
	databases: [
		{
			name: "app",
			charset: "utf8mb4",
			tables: [
				{
					name: "users",
					rows: 18_342,
					sizeBytes: 12 * MiB,
					columns: [
						{
							name: "id",
							type: "bigint",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "email",
							type: "varchar(255)",
							nullable: false,
							key: "unique",
							default: null,
						},
						{
							name: "name",
							type: "varchar(120)",
							nullable: true,
							key: "",
							default: null,
						},
						{
							name: "created_at",
							type: "timestamp",
							nullable: false,
							key: "",
							default: "now()",
						},
					],
				},
				{
					name: "sessions",
					rows: 4_211,
					sizeBytes: 3 * MiB,
					columns: [
						{
							name: "id",
							type: "uuid",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "user_id",
							type: "bigint",
							nullable: false,
							key: "index",
							default: null,
						},
						{
							name: "expires_at",
							type: "timestamp",
							nullable: false,
							key: "index",
							default: null,
						},
					],
				},
				{
					name: "orders",
					rows: 92_750,
					sizeBytes: 64 * MiB,
					columns: [
						{
							name: "id",
							type: "bigint",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "user_id",
							type: "bigint",
							nullable: false,
							key: "index",
							default: null,
						},
						{
							name: "total_cents",
							type: "int",
							nullable: false,
							key: "",
							default: "0",
						},
						{
							name: "status",
							type: "varchar(20)",
							nullable: false,
							key: "",
							default: "'pending'",
						},
						{
							name: "placed_at",
							type: "timestamp",
							nullable: false,
							key: "",
							default: "now()",
						},
					],
				},
				{
					name: "products",
					rows: 1_280,
					sizeBytes: 2 * MiB,
					columns: [
						{
							name: "id",
							type: "bigint",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "sku",
							type: "varchar(64)",
							nullable: false,
							key: "unique",
							default: null,
						},
						{
							name: "name",
							type: "varchar(200)",
							nullable: false,
							key: "",
							default: null,
						},
						{
							name: "price_cents",
							type: "int",
							nullable: false,
							key: "",
							default: "0",
						},
					],
				},
			],
		},
		{
			name: "analytics",
			charset: "utf8mb4",
			tables: [
				{
					name: "events",
					rows: 2_481_900,
					sizeBytes: 512 * MiB,
					columns: [
						{
							name: "id",
							type: "bigint",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "name",
							type: "varchar(120)",
							nullable: false,
							key: "index",
							default: null,
						},
						{
							name: "payload",
							type: "jsonb",
							nullable: true,
							key: "",
							default: null,
						},
						{
							name: "ts",
							type: "timestamp",
							nullable: false,
							key: "index",
							default: "now()",
						},
					],
				},
				{
					name: "page_views",
					rows: 5_120_440,
					sizeBytes: 820 * MiB,
					columns: [
						{
							name: "id",
							type: "bigint",
							nullable: false,
							key: "pk",
							default: null,
						},
						{
							name: "path",
							type: "varchar(255)",
							nullable: false,
							key: "index",
							default: null,
						},
						{
							name: "referrer",
							type: "varchar(255)",
							nullable: true,
							key: "",
							default: null,
						},
						{
							name: "ts",
							type: "timestamp",
							nullable: false,
							key: "",
							default: "now()",
						},
					],
				},
			],
		},
		{ name: "cache", charset: "utf8mb4", tables: [] },
	],
	users: [
		{ name: "root", host: "%", superuser: true, grants: ["*"] },
		{ name: "app_rw", host: "%", superuser: false, grants: ["app"] },
		{
			name: "analytics_ro",
			host: "10.0.0.0/8",
			superuser: false,
			grants: ["analytics"],
		},
		{
			name: "backup",
			host: "127.0.0.1",
			superuser: false,
			grants: ["app", "analytics"],
		},
	],
};

// Keyed by server: each server gets its own copy on its first change; everyone
// else reads the shared DEFAULT_DATA. The whole map is one store value, and the
// per-server hook selects its slice (so a server's view only re-renders when its
// own data changes).
const store = createStore<Map<string, SqlData>>(new Map());

function snapshot(serverId: string): SqlData {
	return store.get().get(serverId) ?? DEFAULT_DATA;
}

export function useSqlData(serverId: string): SqlData {
	return store.useWith((byServer) => byServer.get(serverId) ?? DEFAULT_DATA);
}

function mutate(serverId: string, next: (data: SqlData) => SqlData) {
	const byServer = new Map(store.get());
	byServer.set(serverId, next(snapshot(serverId)));
	store.set(byServer);
}

// — Databases —————————————————————————————————————————————————————————————————

export function createDatabase(
	serverId: string,
	name: string,
	charset: string
) {
	// Appended in place so existing rows don't reorder under the user.
	mutate(serverId, (data) => ({
		...data,
		databases: [...data.databases, { name: name.trim(), charset, tables: [] }],
	}));
}

export function dropDatabase(serverId: string, name: string) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.filter((database) => database.name !== name),
		// A dropped database can't still be granted to anyone.
		users: data.users.map((user) => ({
			...user,
			grants: user.grants.filter((grant) => grant !== name),
		})),
	}));
}

// — Users —————————————————————————————————————————————————————————————————————

export function createUser(serverId: string, user: SqlUser) {
	mutate(serverId, (data) => ({
		...data,
		users: [...data.users, { ...user, name: user.name.trim() }],
	}));
}

export function dropUser(serverId: string, name: string, host: string) {
	mutate(serverId, (data) => ({
		...data,
		users: data.users.filter(
			(user) => !(user.name === name && user.host === host)
		),
	}));
}

// — Tables ————————————————————————————————————————————————————————————————————

export function createTable(
	serverId: string,
	databaseName: string,
	table: SqlTable
) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? { ...database, tables: [...database.tables, table] }
				: database
		),
	}));
}

export function dropTable(
	serverId: string,
	databaseName: string,
	tableName: string
) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						tables: database.tables.filter((table) => table.name !== tableName),
					}
				: database
		),
	}));
}

export function truncateTable(
	serverId: string,
	databaseName: string,
	tableName: string
) {
	mutate(serverId, (data) => ({
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						tables: database.tables.map((table) =>
							table.name === tableName
								? { ...table, rows: 0, sizeBytes: 16 * 1024 }
								: table
						),
					}
				: database
		),
	}));
}

// — Columns ———————————————————————————————————————————————————————————————————

function patchTable(
	data: SqlData,
	databaseName: string,
	tableName: string,
	next: (table: SqlTable) => SqlTable
): SqlData {
	return {
		...data,
		databases: data.databases.map((database) =>
			database.name === databaseName
				? {
						...database,
						tables: database.tables.map((table) =>
							table.name === tableName ? next(table) : table
						),
					}
				: database
		),
	};
}

export function addColumn(
	serverId: string,
	databaseName: string,
	tableName: string,
	column: SqlColumn
) {
	mutate(serverId, (data) =>
		patchTable(data, databaseName, tableName, (table) => ({
			...table,
			columns: [...table.columns, { ...column, name: column.name.trim() }],
		}))
	);
}

export function dropColumn(
	serverId: string,
	databaseName: string,
	tableName: string,
	columnName: string
) {
	mutate(serverId, (data) =>
		patchTable(data, databaseName, tableName, (table) => ({
			...table,
			columns: table.columns.filter((column) => column.name !== columnName),
		}))
	);
}
