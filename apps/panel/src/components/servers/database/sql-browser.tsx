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
	COLUMN_KEY_LABEL,
	grantsLabel,
	isValidIdentifier,
	SQL_CHARSETS,
	SQL_COLUMN_TYPES,
	type SqlColumnKey,
	type SqlData,
	type SqlDatabase,
	type SqlTable,
	type SqlUser,
} from "@/lib/domain/sql-browser";
import { formatBytes, formatCount, pluralize } from "@/lib/format";
import {
	addColumn,
	createDatabase,
	createTable,
	createUser,
	dropColumn,
	dropDatabase,
	dropTable,
	dropUser,
	truncateTable,
	useSqlData,
} from "@/lib/stores/sql-browser-store";

type View = "databases" | "users";

function databaseSize(database: SqlDatabase) {
	return database.tables.reduce((sum, table) => sum + table.sizeBytes, 0);
}

// The SQL Browser: a lightweight phpMyAdmin for a database server. Databases
// drill down to tables and table structure; Users manage access. All against the
// stub sql-browser store, scoped to this server.
export function SqlBrowser({ server }: { server: ServerRow }) {
	const data = useSqlData(server.id);
	const [view, setView] = useState<View>("databases");
	const [database, setDatabase] = useState<string | null>(null);
	const [table, setTable] = useState<string | null>(null);

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
						count={data.databases.length}
						icon={Database}
						label="Databases"
						onClick={() => setView("databases")}
						value="databases"
					/>
					<Subtab
						active={view === "users"}
						count={data.users.length}
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
					<DatabasesPanel
						data={data}
						database={database}
						onDatabase={(name) => {
							setDatabase(name);
							setTable(null);
						}}
						onTable={setTable}
						serverId={server.id}
						table={table}
					/>
				) : (
					<UsersPanel data={data} serverId={server.id} />
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
	count: number;
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
			<span className="font-mono text-muted-foreground text-xs tabular-nums">
				{count}
			</span>
		</button>
	);
}

// — Databases —————————————————————————————————————————————————————————————————

function DatabasesPanel({
	data,
	database,
	onDatabase,
	onTable,
	serverId,
	table,
}: {
	data: SqlData;
	database: string | null;
	onDatabase: (name: string | null) => void;
	onTable: (name: string | null) => void;
	serverId: string;
	table: string | null;
}) {
	const selectedDb = database
		? data.databases.find((item) => item.name === database)
		: undefined;
	// A dropped database (or table) can disappear underneath us; fall back up.
	if (database && !selectedDb) {
		return <DatabaseList data={data} onOpen={onDatabase} serverId={serverId} />;
	}
	if (selectedDb && table) {
		const selectedTable = selectedDb.tables.find((item) => item.name === table);
		if (!selectedTable) {
			return (
				<TableList
					database={selectedDb}
					onBack={() => onDatabase(null)}
					onOpen={onTable}
					serverId={serverId}
				/>
			);
		}
		return (
			<TableStructure
				database={selectedDb}
				onBack={() => onTable(null)}
				onRoot={() => onDatabase(null)}
				serverId={serverId}
				table={selectedTable}
			/>
		);
	}
	if (selectedDb) {
		return (
			<TableList
				database={selectedDb}
				onBack={() => onDatabase(null)}
				onOpen={onTable}
				serverId={serverId}
			/>
		);
	}
	return <DatabaseList data={data} onOpen={onDatabase} serverId={serverId} />;
}

function DatabaseList({
	data,
	onOpen,
	serverId,
}: {
	data: SqlData;
	onOpen: (name: string) => void;
	serverId: string;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New database
				</Button>
			}
			subtitle={pluralize(data.databases.length, "database")}
			title="Databases"
		>
			{data.databases.length === 0 ? (
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
						{data.databases.map((database) => (
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
									{database.tables.length}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatBytes(databaseSize(database))}
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
				existing={data.databases.map((database) => database.name)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Drop database"
				description={`Drop the database “${drop}” and everything in it. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						dropDatabase(serverId, drop);
						toast.success(`Dropped database “${drop}”.`);
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
	database: SqlDatabase;
	onBack: () => void;
	onOpen: (name: string) => void;
	serverId: string;
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);
	const [truncate, setTruncate] = useState<string | null>(null);

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New table
				</Button>
			}
			subtitle={`${database.charset} · ${pluralize(database.tables.length, "table")}`}
			title={
				<Breadcrumb
					trail={[{ label: "Databases", onClick: onBack }]}
					current={database.name}
				/>
			}
		>
			{database.tables.length === 0 ? (
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
						{database.tables.map((table) => (
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
									{table.columns.length}
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

			<NewTableDialog
				databaseName={database.name}
				existing={database.tables.map((table) => table.name)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Truncate"
				description={`Delete every row in “${truncate}”. The table and its columns stay. This can't be undone.`}
				onConfirm={() => {
					if (truncate) {
						truncateTable(serverId, database.name, truncate);
						toast.success(`Truncated “${truncate}”.`);
					}
				}}
				onOpenChange={(next) => setTruncate(next ? truncate : null)}
				open={truncate !== null}
				title="Truncate this table?"
			/>
			<ConfirmDrop
				confirmLabel="Drop table"
				description={`Drop the table “${drop}” and all its data. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						dropTable(serverId, database.name, drop);
						toast.success(`Dropped table “${drop}”.`);
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
	onBack,
	onRoot,
	serverId,
	table,
}: {
	database: SqlDatabase;
	onBack: () => void;
	onRoot: () => void;
	serverId: string;
	table: SqlTable;
}) {
	const [addOpen, setAddOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	return (
		<Section
			action={
				<Button onClick={() => setAddOpen(true)} size="sm">
					<Plus />
					Add column
				</Button>
			}
			subtitle={`${formatCount(table.rows)} rows · ${formatBytes(table.sizeBytes)}`}
			title={
				<Breadcrumb
					current={table.name}
					trail={[
						{ label: "Databases", onClick: onRoot },
						{ label: database.name, onClick: onBack },
					]}
				/>
			}
		>
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
					{table.columns.map((column) => (
						<TableRow key={column.name}>
							<TableCell className="font-mono text-sm">{column.name}</TableCell>
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
										{COLUMN_KEY_LABEL[column.key]}
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

			<AddColumnDialog
				databaseName={database.name}
				existing={table.columns.map((column) => column.name)}
				onOpenChange={setAddOpen}
				open={addOpen}
				serverId={serverId}
				tableName={table.name}
			/>
			<ConfirmDrop
				confirmLabel="Drop column"
				description={`Drop the column “${drop}” from “${table.name}”. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						dropColumn(serverId, database.name, table.name, drop);
						toast.success(`Dropped column “${drop}”.`);
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

function UsersPanel({ data, serverId }: { data: SqlData; serverId: string }) {
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<SqlUser | null>(null);

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New user
				</Button>
			}
			subtitle={pluralize(data.users.length, "user")}
			title="Users"
		>
			{data.users.length === 0 ? (
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
						{data.users.map((user) => (
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
									{user.host}
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
				databases={data.databases.map((database) => database.name)}
				existing={data.users.map((user) => `${user.name}@${user.host}`)}
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Drop user"
				description={`Drop the user “${drop?.name}”@“${drop?.host}”. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						dropUser(serverId, drop.name, drop.host);
						toast.success(`Dropped user “${drop.name}”.`);
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

function NewDatabaseDialog({
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [name, setName] = useState("");
	const [charset, setCharset] = useState<string>(SQL_CHARSETS[0]);

	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

	function reset() {
		setName("");
		setCharset(SQL_CHARSETS[0]);
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
						if (!valid) {
							return;
						}
						createDatabase(serverId, trimmed, charset);
						toast.success(`Created database “${trimmed}”.`);
						onOpenChange(false);
						reset();
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
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid} type="submit">
							Create database
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function NewTableDialog({
	databaseName,
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	databaseName: string;
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [name, setName] = useState("");
	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

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
						if (!valid) {
							return;
						}
						createTable(serverId, databaseName, {
							name: trimmed,
							rows: 0,
							sizeBytes: 16 * 1024,
							columns: [
								{
									name: "id",
									type: "bigint",
									nullable: false,
									key: "pk",
									default: null,
								},
							],
						});
						toast.success(`Created table “${trimmed}”.`);
						onOpenChange(false);
						setName("");
					}}
				>
					<DialogHeader>
						<DialogTitle>New table in {databaseName}</DialogTitle>
						<DialogDescription>
							Creates the table with an auto-incrementing id column to start.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="table-name">Name</Label>
						<Input
							aria-invalid={Boolean(trimmed) && !valid}
							className="font-mono text-sm"
							id="table-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="invoices"
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
						<Button disabled={!valid} type="submit">
							Create table
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Radix Select forbids an empty-string value, so "no key" rides a sentinel at
// the Select layer; the stored SqlColumnKey is still "" for none.
const KEY_NONE = "none";
const COLUMN_KEYS: { value: string; label: string }[] = [
	{ value: KEY_NONE, label: "None" },
	{ value: "index", label: "Index" },
	{ value: "unique", label: "Unique" },
	{ value: "pk", label: "Primary key" },
];

function AddColumnDialog({
	databaseName,
	existing,
	onOpenChange,
	open,
	serverId,
	tableName,
}: {
	databaseName: string;
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
	tableName: string;
}) {
	const [name, setName] = useState("");
	const [type, setType] = useState<string>(SQL_COLUMN_TYPES[0]);
	const [nullable, setNullable] = useState(true);
	const [key, setKey] = useState<SqlColumnKey>("");

	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidIdentifier(trimmed) && !duplicate;

	function reset() {
		setName("");
		setType(SQL_COLUMN_TYPES[0]);
		setNullable(true);
		setKey("");
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
						if (!valid) {
							return;
						}
						addColumn(serverId, databaseName, tableName, {
							name: trimmed,
							type,
							nullable: key === "pk" ? false : nullable,
							key,
							default: null,
						});
						toast.success(`Added column “${trimmed}”.`);
						onOpenChange(false);
						reset();
					}}
				>
					<DialogHeader>
						<DialogTitle>Add column to {tableName}</DialogTitle>
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
										{SQL_COLUMN_TYPES.map((option) => (
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
										setKey(value === KEY_NONE ? "" : (value as SqlColumnKey))
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
									Whether the column can be empty. Off for a primary key.
								</p>
							</div>
							<Switch
								checked={key === "pk" ? false : nullable}
								disabled={key === "pk"}
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
						<Button disabled={!valid} type="submit">
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
	databases,
	existing,
	onOpenChange,
	open,
	serverId,
}: {
	databases: string[];
	existing: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [name, setName] = useState("");
	const [host, setHost] = useState("%");
	const [password, setPassword] = useState("");
	const [access, setAccess] = useState<string>(databases[0] ?? NO_ACCESS);

	const trimmed = name.trim();
	const duplicate = existing.includes(`${trimmed}@${host.trim()}`);
	const valid = isValidIdentifier(trimmed) && host.trim() !== "" && !duplicate;

	function reset() {
		setName("");
		setHost("%");
		setPassword("");
		setAccess(databases[0] ?? NO_ACCESS);
	}

	function grantsFor(): string[] {
		if (access === ALL_ACCESS) {
			return ["*"];
		}
		if (access === NO_ACCESS) {
			return [];
		}
		return [access];
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
						if (!valid) {
							return;
						}
						const grants = grantsFor();
						createUser(serverId, {
							name: trimmed,
							host: host.trim(),
							superuser: access === ALL_ACCESS,
							grants,
						});
						toast.success(`Created user “${trimmed}”.`);
						onOpenChange(false);
						reset();
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
								Stored encrypted. We'll never show it again.
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
						<Button disabled={!valid} type="submit">
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
