import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronRight,
	Columns3,
	Database,
	Eraser,
	KeyRound,
	Plus,
	Table2,
	Trash2,
	Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	Breadcrumb,
	ConfirmDrop,
	ConnectionHeader,
	IconAction,
	RowActions,
	Section,
} from "@/components/servers/database/explorer-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ServerRow } from "@/lib/domain/servers";
import {
	columnKeyLabel,
	columnTypes,
	grantsLabel,
	isValidIdentifier,
	SQL_CHARSETS,
	type SqlEngine,
	type SqlUser,
	sqlEngine,
} from "@/lib/domain/sql-browser";
import { formatBytes, formatCount, pluralize } from "@/lib/format";
import {
	addSqlColumn,
	createSqlDatabase,
	createSqlTable,
	createSqlUser,
	dropSqlColumn,
	dropSqlDatabase,
	dropSqlTable,
	dropSqlUser,
	invalidateSql,
	truncateSqlTable,
	useSqlColumns,
	useSqlDatabases,
	useSqlTables,
	useSqlUsers,
} from "@/lib/sql-browser-queries";

type View = "databases" | "users";

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

// The SQL Browser: a lightweight phpMyAdmin for a database server (PostgreSQL or
// MySQL/MariaDB). Databases drill down to tables and table structure; Users manage
// access. Everything is fetched live from the running instance, lazily per level.
export function SqlBrowser({ server }: { server: ServerRow }) {
	const engine = sqlEngine(server.eggName);
	const [view, setView] = useState<View>("databases");
	const [database, setDatabase] = useState<string | null>(null);
	const [table, setTable] = useState<string | null>(null);

	const databases = useSqlDatabases(server.id);
	const users = useSqlUsers(server.id);
	const dbCount = databases?.ok ? databases.data.length : undefined;
	const userCount = users?.ok ? users.data.length : undefined;

	return (
		<div className="space-y-4">
			<ConnectionHeader label="Browser" server={server} />

			<div className="border-b">
				<div
					aria-label="SQL Browser sections"
					className="-mb-px flex gap-4"
					role="tablist"
				>
					<Subtab
						active={view === "databases"}
						count={dbCount}
						icon={Database}
						label="Databases"
						onClick={() => setView("databases")}
						value="databases"
					/>
					<Subtab
						active={view === "users"}
						count={userCount}
						icon={Users}
						label="Users"
						onClick={() => setView("users")}
						value="users"
					/>
				</div>
			</div>

			<div
				aria-labelledby={`sqlb-tab-${view}`}
				id={`sqlb-panel-${view}`}
				role="tabpanel"
			>
				{view === "databases" ? (
					database && table ? (
						<TableStructure
							database={database}
							engine={engine}
							onBack={() => setTable(null)}
							onRoot={() => {
								setDatabase(null);
								setTable(null);
							}}
							serverId={server.id}
							table={table}
						/>
					) : database ? (
						<TableList
							database={database}
							onBack={() => setDatabase(null)}
							onOpen={setTable}
							serverId={server.id}
						/>
					) : (
						<DatabaseList
							engine={engine}
							onOpen={(name) => {
								setDatabase(name);
								setTable(null);
							}}
							serverId={server.id}
						/>
					)
				) : (
					<UsersPanel engine={engine} serverId={server.id} />
				)}
			</div>
		</div>
	);
}

function Subtab({
	active,
	count,
	icon: Icon,
	label,
	onClick,
	value,
}: {
	active: boolean;
	count: number | undefined;
	icon: typeof Database;
	label: string;
	onClick: () => void;
	value: View;
}) {
	return (
		<button
			aria-controls={`sqlb-panel-${value}`}
			aria-selected={active}
			className="flex items-center gap-2 border-transparent border-b-2 px-1 pb-3 text-muted-foreground text-sm transition-colors hover:text-foreground aria-selected:border-primary aria-selected:font-medium aria-selected:text-foreground"
			id={`sqlb-tab-${value}`}
			onClick={onClick}
			role="tab"
			type="button"
		>
			<Icon className="size-4" />
			{label}
			{count !== undefined ? (
				<span className="font-mono text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			) : null}
		</button>
	);
}

// — Databases —————————————————————————————————————————————————————————————————

function DatabaseList({
	engine,
	onOpen,
	serverId,
}: {
	engine: SqlEngine;
	onOpen: (name: string) => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const read = useSqlDatabases(serverId);
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	const databases = read?.ok ? read.data : [];

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New database
				</Button>
			}
			subtitle={
				read?.ok ? `${pluralize(databases.length, "database")}` : undefined
			}
			title="Databases"
		>
			{read && !read.ok ? (
				<div className="p-4">
					<EmptyState
						description={read.error}
						icon={Database}
						title="Couldn't reach the database"
					/>
				</div>
			) : !read ? (
				<Loading />
			) : databases.length === 0 ? (
				<div className="p-4">
					<EmptyState
						description="Create a database to start storing data."
						icon={Database}
						title="No databases yet"
					/>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Database</TableHead>
							<TableHead>Charset</TableHead>
							<TableHead className="text-right">Tables</TableHead>
							<TableHead className="text-right">Size</TableHead>
							<TableHead className="w-px text-right">Manage</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{databases.map((database) => (
							<TableRow key={database.name}>
								<TableCell>
									<button
										className="flex items-center gap-2 font-medium text-sm hover:text-primary"
										onClick={() => onOpen(database.name)}
										type="button"
									>
										<Database className="size-4 text-muted-foreground" />
										{database.name}
									</button>
								</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{database.charset}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{database.tables < 0 ? "—" : database.tables}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatBytes(database.sizeBytes)}
								</TableCell>
								<TableCell className="text-right">
									<RowActions>
										<IconAction
											icon={ChevronRight}
											label={`Open ${database.name}`}
											onClick={() => onOpen(database.name)}
										/>
										<IconAction
											danger
											icon={Trash2}
											label={`Drop ${database.name}`}
											onClick={() => setDrop(database.name)}
										/>
									</RowActions>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<NewDatabaseDialog
				engine={engine}
				existing={databases.map((database) => database.name)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Drop database"
				description={`Drop the database “${drop}” and everything in it. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropSqlDatabase(serverId, drop);
						await invalidateSql(queryClient, serverId);
						toast.success(`Dropped database “${drop}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't drop the database."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Drop this database?"
			/>
		</Section>
	);
}

function TableList({
	database,
	onBack,
	onOpen,
	serverId,
}: {
	database: string;
	onBack: () => void;
	onOpen: (name: string) => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const read = useSqlTables(serverId, database);
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);
	const [truncate, setTruncate] = useState<string | null>(null);

	const tables = read?.ok ? read.data : [];

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New table
				</Button>
			}
			subtitle={read?.ok ? `${pluralize(tables.length, "table")}` : undefined}
			title={
				<Breadcrumb
					current={database}
					trail={[{ label: "Databases", onClick: onBack }]}
				/>
			}
		>
			{read && !read.ok ? (
				<div className="p-4">
					<EmptyState
						description={read.error}
						icon={Table2}
						title="Couldn't reach the database"
					/>
				</div>
			) : !read ? (
				<Loading />
			) : tables.length === 0 ? (
				<div className="p-4">
					<EmptyState
						description="Create a table to define this database's structure."
						icon={Table2}
						title="No tables yet"
					/>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Table</TableHead>
							<TableHead className="text-right">Rows</TableHead>
							<TableHead className="text-right">Size</TableHead>
							<TableHead className="text-right">Columns</TableHead>
							<TableHead className="w-px text-right">Manage</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{tables.map((table) => (
							<TableRow key={table.name}>
								<TableCell>
									<button
										className="flex items-center gap-2 font-medium text-sm hover:text-primary"
										onClick={() => onOpen(table.name)}
										type="button"
									>
										<Table2 className="size-4 text-muted-foreground" />
										{table.name}
									</button>
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatCount(table.rows)}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatBytes(table.sizeBytes)}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{table.columns}
								</TableCell>
								<TableCell className="text-right">
									<RowActions>
										<IconAction
											icon={Columns3}
											label={`Structure of ${table.name}`}
											onClick={() => onOpen(table.name)}
										/>
										<IconAction
											icon={Eraser}
											label={`Truncate ${table.name}`}
											onClick={() => setTruncate(table.name)}
										/>
										<IconAction
											danger
											icon={Trash2}
											label={`Drop ${table.name}`}
											onClick={() => setDrop(table.name)}
										/>
									</RowActions>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<NameDialog
				existing={tables.map((table) => table.name)}
				onCreate={async (name) => {
					try {
						await createSqlTable(serverId, database, name);
						await invalidateSql(queryClient, serverId);
						toast.success(`Created table “${name}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't create the table."));
					}
				}}
				onOpenChange={setCreateOpen}
				open={createOpen}
				placeholder="invoices"
				submitLabel="Create table"
				subtitle="Creates the table with an auto-incrementing id column to start."
				title={`New table in ${database}`}
			/>
			<ConfirmDrop
				confirmLabel="Truncate"
				description={`Delete every row in “${truncate}”. The table and its columns stay. This can't be undone.`}
				onConfirm={async () => {
					if (!truncate) {
						return;
					}
					try {
						await truncateSqlTable(serverId, database, truncate);
						await invalidateSql(queryClient, serverId);
						toast.success(`Truncated “${truncate}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't truncate the table."));
					}
				}}
				onOpenChange={(next) => setTruncate(next ? truncate : null)}
				open={truncate !== null}
				title="Truncate this table?"
			/>
			<ConfirmDrop
				confirmLabel="Drop table"
				description={`Drop the table “${drop}” and all its data. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropSqlTable(serverId, database, drop);
						await invalidateSql(queryClient, serverId);
						toast.success(`Dropped table “${drop}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't drop the table."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Drop this table?"
			/>
		</Section>
	);
}

function TableStructure({
	database,
	engine,
	onBack,
	onRoot,
	serverId,
	table,
}: {
	database: string;
	engine: SqlEngine;
	onBack: () => void;
	onRoot: () => void;
	serverId: string;
	table: string;
}) {
	const queryClient = useQueryClient();
	const read = useSqlColumns(serverId, database, table);
	const [addOpen, setAddOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	const columns = read?.ok ? read.data : [];

	return (
		<Section
			action={
				<Button onClick={() => setAddOpen(true)} size="sm">
					<Plus />
					Add column
				</Button>
			}
			subtitle={read?.ok ? `${pluralize(columns.length, "column")}` : undefined}
			title={
				<Breadcrumb
					current={table}
					trail={[
						{ label: "Databases", onClick: onRoot },
						{ label: database, onClick: onBack },
					]}
				/>
			}
		>
			{read && !read.ok ? (
				<div className="p-4">
					<EmptyState
						description={read.error}
						icon={Columns3}
						title="Couldn't reach the database"
					/>
				</div>
			) : !read ? (
				<Loading />
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Column</TableHead>
							<TableHead>Type</TableHead>
							<TableHead>Null</TableHead>
							<TableHead>Key</TableHead>
							<TableHead>Default</TableHead>
							<TableHead className="w-px text-right">Drop</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{columns.map((column) => (
							<TableRow key={column.name}>
								<TableCell className="font-mono text-sm">
									{column.name}
								</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{column.type}
								</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{column.nullable ? "YES" : "NO"}
								</TableCell>
								<TableCell>
									{column.key ? (
										<span className="inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase">
											{column.key === "pk" ? (
												<KeyRound className="size-3" />
											) : null}
											{columnKeyLabel(column.key)}
										</span>
									) : (
										<span className="text-muted-foreground text-xs">—</span>
									)}
								</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{column.default ?? "—"}
								</TableCell>
								<TableCell className="text-right">
									<IconAction
										danger
										icon={Trash2}
										label={`Drop column ${column.name}`}
										onClick={() => setDrop(column.name)}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<AddColumnDialog
				database={database}
				engine={engine}
				existing={columns.map((column) => column.name)}
				onOpenChange={setAddOpen}
				open={addOpen}
				serverId={serverId}
				table={table}
			/>
			<ConfirmDrop
				confirmLabel="Drop column"
				description={`Drop the column “${drop}” from “${table}”. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropSqlColumn(serverId, database, table, drop);
						await invalidateSql(queryClient, serverId);
						toast.success(`Dropped column “${drop}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't drop the column."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Drop this column?"
			/>
		</Section>
	);
}

// — Users —————————————————————————————————————————————————————————————————————

function UsersPanel({
	engine,
	serverId,
}: {
	engine: SqlEngine;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const read = useSqlUsers(serverId);
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<SqlUser | null>(null);

	const users = read?.ok ? read.data : [];

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New user
				</Button>
			}
			subtitle={read?.ok ? `${pluralize(users.length, "user")}` : undefined}
			title="Users"
		>
			{read && !read.ok ? (
				<div className="p-4">
					<EmptyState
						description={read.error}
						icon={Users}
						title="Couldn't reach the database"
					/>
				</div>
			) : !read ? (
				<Loading />
			) : users.length === 0 ? (
				<div className="p-4">
					<EmptyState
						description="Create a user to grant access to your databases."
						icon={Users}
						title="No users yet"
					/>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>User</TableHead>
							<TableHead>Host</TableHead>
							<TableHead>Access</TableHead>
							<TableHead className="w-px text-right">Drop</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{users.map((user) => (
							<TableRow key={`${user.name}@${user.host}`}>
								<TableCell>
									<span className="flex items-center gap-2 font-medium text-sm">
										{user.name}
										{user.superuser ? (
											<Badge variant="secondary">Superuser</Badge>
										) : null}
									</span>
								</TableCell>
								<TableCell className="font-mono text-muted-foreground text-xs">
									{user.host || "—"}
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">
									{grantsLabel(user)}
								</TableCell>
								<TableCell className="text-right">
									<IconAction
										danger
										icon={Trash2}
										label={`Drop ${user.name}`}
										onClick={() => setDrop(user)}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<NewUserDialog
				engine={engine}
				existing={users.map((user) => `${user.name}@${user.host}`)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Drop user"
				description={`Drop the user “${drop?.name}”${
					drop?.host ? `@“${drop.host}”` : ""
				}. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropSqlUser(serverId, drop.name, drop.host);
						await invalidateSql(queryClient, serverId);
						toast.success(`Dropped user “${drop.name}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't drop the user."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Drop this user?"
			/>
		</Section>
	);
}

// — Dialogs ———————————————————————————————————————————————————————————————————

function Loading() {
	return (
		<div className="p-8 text-center text-muted-foreground text-sm">
			Loading…
		</div>
	);
}

function NewDatabaseDialog({
	engine,
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	engine: SqlEngine;
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [charset, setCharset] = useState<string>(SQL_CHARSETS[0]);
	const [busy, setBusy] = useState(false);

	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

	function reset() {
		setName("");
		setCharset(SQL_CHARSETS[0]);
	}

	async function submit() {
		setBusy(true);
		try {
			await createSqlDatabase(
				serverId,
				trimmed,
				engine === "mysql" ? charset : ""
			);
			await invalidateSql(queryClient, serverId);
			toast.success(`Created database “${trimmed}”.`);
			onOpenChange(false);
			reset();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't create the database."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							submit();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>New database</DialogTitle>
						<DialogDescription>
							Create an empty database on this server.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="db-name">Name</Label>
							<Input
								aria-invalid={Boolean(trimmed) && !valid}
								className="font-mono text-sm"
								id="db-name"
								onChange={(event) => setName(event.target.value)}
								placeholder="analytics"
								value={name}
							/>
							<IdentityHint duplicate={duplicate} value={trimmed} />
						</div>
						{engine === "mysql" ? (
							<div className="grid gap-2">
								<Label htmlFor="db-charset">Character set</Label>
								<Select onValueChange={setCharset} value={charset}>
									<SelectTrigger className="w-full" id="db-charset">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{SQL_CHARSETS.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || !valid} type="submit">
							Create database
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// A single-name create dialog (tables).
function NameDialog({
	existing,
	onCreate,
	onOpenChange,
	open,
	placeholder,
	submitLabel,
	subtitle,
	title,
}: {
	existing: string[];
	onCreate: (name: string) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	placeholder: string;
	submitLabel: string;
	subtitle: string;
	title: string;
}) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

	async function submit() {
		setBusy(true);
		await onCreate(trimmed);
		setBusy(false);
		onOpenChange(false);
		setName("");
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setName("");
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							submit();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{subtitle}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="sql-name">Name</Label>
						<Input
							aria-invalid={Boolean(trimmed) && !valid}
							className="font-mono text-sm"
							id="sql-name"
							onChange={(event) => setName(event.target.value)}
							placeholder={placeholder}
							value={name}
						/>
						<IdentityHint duplicate={duplicate} value={trimmed} />
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || !valid} type="submit">
							{submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Radix Select forbids an empty-string value, so "no key" rides a sentinel at the
// Select layer; the value sent to the daemon is still "" for none.
const KEY_NONE = "none";
const COLUMN_KEYS: { value: string; label: string }[] = [
	{ value: KEY_NONE, label: "None" },
	{ value: "index", label: "Index" },
	{ value: "unique", label: "Unique" },
];

function AddColumnDialog({
	database,
	engine,
	existing,
	onOpenChange,
	open,
	serverId,
	table,
}: {
	database: string;
	engine: SqlEngine;
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
	table: string;
}) {
	const queryClient = useQueryClient();
	const types = columnTypes(engine);
	const defaultType = types[0] ?? "bigint";
	const [name, setName] = useState("");
	const [type, setType] = useState<string>(defaultType);
	const [nullable, setNullable] = useState(true);
	const [key, setKey] = useState<"" | "index" | "unique">("");
	const [busy, setBusy] = useState(false);

	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

	function reset() {
		setName("");
		setType(defaultType);
		setNullable(true);
		setKey("");
	}

	async function submit() {
		setBusy(true);
		try {
			await addSqlColumn(serverId, database, table, {
				name: trimmed,
				type,
				nullable,
				key,
			});
			await invalidateSql(queryClient, serverId);
			toast.success(`Added column “${trimmed}”.`);
			onOpenChange(false);
			reset();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't add the column."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							submit();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>Add column to {table}</DialogTitle>
						<DialogDescription>
							Define the column's name, type, and key.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="col-name">Name</Label>
							<Input
								aria-invalid={Boolean(trimmed) && !valid}
								className="font-mono text-sm"
								id="col-name"
								onChange={(event) => setName(event.target.value)}
								placeholder="updated_at"
								value={name}
							/>
							<IdentityHint duplicate={duplicate} value={trimmed} />
						</div>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="col-type">Type</Label>
								<Select onValueChange={setType} value={type}>
									<SelectTrigger className="w-full" id="col-type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{types.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="col-key">Key</Label>
								<Select
									onValueChange={(value) =>
										setKey(
											value === KEY_NONE ? "" : (value as "index" | "unique")
										)
									}
									value={key === "" ? KEY_NONE : key}
								>
									<SelectTrigger className="w-full" id="col-key">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{COLUMN_KEYS.map((option) => (
											<SelectItem key={option.label} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="flex items-center justify-between gap-4 rounded-lg border p-3">
							<div className="space-y-0.5">
								<Label htmlFor="col-nullable">Allow null</Label>
								<p className="text-muted-foreground text-xs">
									Whether the column can be empty.
								</p>
							</div>
							<Switch
								checked={nullable}
								id="col-nullable"
								onCheckedChange={setNullable}
							/>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || !valid} type="submit">
							Add column
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// The '*' makes these fail SQL_IDENTIFIER, so a real database name can never
// collide with the access sentinels.
const NO_ACCESS = "*none*";
const ALL_ACCESS = "*all*";

function NewUserDialog({
	engine,
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	engine: SqlEngine;
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const databasesRead = useSqlDatabases(serverId);
	const databases = databasesRead?.ok
		? databasesRead.data.map((database) => database.name)
		: [];

	const [name, setName] = useState("");
	const [host, setHost] = useState("%");
	const [password, setPassword] = useState("");
	const [access, setAccess] = useState<string>(NO_ACCESS);
	const [busy, setBusy] = useState(false);

	const trimmed = name.trim();
	const hostKey = engine === "mysql" ? host.trim() : "";
	const duplicate = existing.includes(`${trimmed}@${hostKey}`);
	const valid =
		isValidIdentifier(trimmed) &&
		(engine !== "mysql" || host.trim() !== "") &&
		!duplicate;

	function reset() {
		setName("");
		setHost("%");
		setPassword("");
		setAccess(NO_ACCESS);
	}

	function accessValue(): string {
		if (access === ALL_ACCESS) {
			return "*";
		}
		if (access === NO_ACCESS) {
			return "";
		}
		return access;
	}

	async function submit() {
		setBusy(true);
		try {
			await createSqlUser(serverId, {
				name: trimmed,
				host: engine === "mysql" ? host.trim() : "%",
				newPassword: password,
				access: accessValue(),
			});
			await invalidateSql(queryClient, serverId);
			toast.success(`Created user “${trimmed}”.`);
			onOpenChange(false);
			reset();
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't create the user."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) {
							submit();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>New user</DialogTitle>
						<DialogDescription>
							Create a database user and grant it access.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="grid gap-2">
								<Label htmlFor="user-name">Username</Label>
								<Input
									aria-invalid={Boolean(trimmed) && !valid}
									className="font-mono text-sm"
									id="user-name"
									onChange={(event) => setName(event.target.value)}
									placeholder="app_rw"
									value={name}
								/>
							</div>
							{engine === "mysql" ? (
								<div className="grid gap-2">
									<Label htmlFor="user-host">Host</Label>
									<Input
										className="font-mono text-sm"
										id="user-host"
										onChange={(event) => setHost(event.target.value)}
										placeholder="%"
										value={host}
									/>
								</div>
							) : null}
						</div>
						<IdentityHint duplicate={duplicate} value={trimmed} />
						<div className="grid gap-2">
							<Label htmlFor="user-password">Password</Label>
							<Input
								autoComplete="new-password"
								id="user-password"
								onChange={(event) => setPassword(event.target.value)}
								placeholder="Set a password"
								type="password"
								value={password}
							/>
							<p className="text-muted-foreground text-xs">
								Sent straight to the database; we never store it.
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="user-access">Access</Label>
							<Select onValueChange={setAccess} value={access}>
								<SelectTrigger className="w-full" id="user-access">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_ACCESS}>
										All databases (superuser)
									</SelectItem>
									{databases.map((database) => (
										<SelectItem key={database} value={database}>
											{database}
										</SelectItem>
									))}
									<SelectItem value={NO_ACCESS}>No access yet</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || !valid} type="submit">
							Create user
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// A shared name-validation hint for the create dialogs.
function IdentityHint({
	duplicate,
	value,
}: {
	duplicate: boolean;
	value: string;
}) {
	if (duplicate) {
		return (
			<p className="text-destructive text-xs">That name is already taken.</p>
		);
	}
	if (value !== "" && !isValidIdentifier(value)) {
		return (
			<p className="text-destructive text-xs">
				Use letters, numbers, and underscores; start with a letter.
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-xs">
			Letters, numbers, and underscores.
		</p>
	);
}
