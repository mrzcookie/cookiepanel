import {
	type QueryClient,
	queryOptions,
	useQuery,
} from "@tanstack/react-query";
import type { DaemonRead } from "@/lib/domain/nodes";
import type {
	SqlColumn,
	SqlDatabase,
	SqlTable,
	SqlUser,
} from "@/lib/domain/sql-browser";
import {
	addSqlColumn as addSqlColumnFn,
	createSqlDatabase as createSqlDatabaseFn,
	createSqlTable as createSqlTableFn,
	createSqlUser as createSqlUserFn,
	dropSqlColumn as dropSqlColumnFn,
	dropSqlDatabase as dropSqlDatabaseFn,
	dropSqlTable as dropSqlTableFn,
	dropSqlUser as dropSqlUserFn,
	getSqlColumns as getSqlColumnsFn,
	getSqlDatabases as getSqlDatabasesFn,
	getSqlTables as getSqlTablesFn,
	getSqlUsers as getSqlUsersFn,
	truncateSqlTable as truncateSqlTableFn,
} from "@/server/sql-browser";

// Query factories + hooks + mutation wrappers for the SQL browser. Reads degrade
// to `{ ok: false }` offline. Keyed under `["sql", serverId, …]` so one
// invalidation refreshes a server's views after any mutation.

export function sqlDatabasesQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["sql", serverId, "databases"] as const,
		queryFn: () => getSqlDatabasesFn({ data: { serverId } }),
		retry: false,
		staleTime: 5_000,
	});
}

export function useSqlDatabases(
	serverId: string
): DaemonRead<SqlDatabase[]> | undefined {
	return useQuery(sqlDatabasesQueryOptions(serverId)).data;
}

export function sqlTablesQueryOptions(serverId: string, db: string) {
	return queryOptions({
		queryKey: ["sql", serverId, "tables", db] as const,
		queryFn: () => getSqlTablesFn({ data: { serverId, db } }),
		retry: false,
		staleTime: 5_000,
	});
}

export function useSqlTables(
	serverId: string,
	db: string
): DaemonRead<SqlTable[]> | undefined {
	return useQuery(sqlTablesQueryOptions(serverId, db)).data;
}

export function sqlColumnsQueryOptions(
	serverId: string,
	db: string,
	table: string
) {
	return queryOptions({
		queryKey: ["sql", serverId, "columns", db, table] as const,
		queryFn: () => getSqlColumnsFn({ data: { serverId, db, table } }),
		retry: false,
	});
}

export function useSqlColumns(
	serverId: string,
	db: string,
	table: string
): DaemonRead<SqlColumn[]> | undefined {
	return useQuery(sqlColumnsQueryOptions(serverId, db, table)).data;
}

export function sqlUsersQueryOptions(serverId: string) {
	return queryOptions({
		queryKey: ["sql", serverId, "users"] as const,
		queryFn: () => getSqlUsersFn({ data: { serverId } }),
		retry: false,
		staleTime: 5_000,
	});
}

export function useSqlUsers(
	serverId: string
): DaemonRead<SqlUser[]> | undefined {
	return useQuery(sqlUsersQueryOptions(serverId)).data;
}

// ─── mutations ───────────────────────────────────────────────────────────────

export function createSqlDatabase(
	serverId: string,
	db: string,
	charset: string
) {
	return createSqlDatabaseFn({ data: { serverId, db, charset } });
}

export function dropSqlDatabase(serverId: string, db: string) {
	return dropSqlDatabaseFn({ data: { serverId, db } });
}

export function createSqlTable(serverId: string, db: string, table: string) {
	return createSqlTableFn({ data: { serverId, db, table } });
}

export function dropSqlTable(serverId: string, db: string, table: string) {
	return dropSqlTableFn({ data: { serverId, db, table } });
}

export function truncateSqlTable(serverId: string, db: string, table: string) {
	return truncateSqlTableFn({ data: { serverId, db, table } });
}

export function addSqlColumn(
	serverId: string,
	db: string,
	table: string,
	column: {
		name: string;
		type: string;
		nullable: boolean;
		key: "" | "index" | "unique";
	}
) {
	return addSqlColumnFn({ data: { serverId, db, table, ...column } });
}

export function dropSqlColumn(
	serverId: string,
	db: string,
	table: string,
	column: string
) {
	return dropSqlColumnFn({ data: { serverId, db, table, column } });
}

export function createSqlUser(
	serverId: string,
	user: { name: string; host: string; newPassword: string; access: string }
) {
	return createSqlUserFn({ data: { serverId, ...user } });
}

export function dropSqlUser(serverId: string, name: string, host: string) {
	return dropSqlUserFn({ data: { serverId, name, host } });
}

/** Refresh every SQL view for a server (after any mutation). */
export function invalidateSql(
	queryClient: QueryClient,
	serverId: string
): Promise<void> {
	return queryClient.invalidateQueries({ queryKey: ["sql", serverId] });
}
