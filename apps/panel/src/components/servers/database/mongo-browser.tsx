import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileJson, FolderTree, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ServerConnection } from "@/components/servers/database/explorer-shell";
import {
	Breadcrumb,
	ConfirmDrop,
	ConnectionHeader,
	IconAction,
	RowActions,
	Section,
} from "@/components/servers/database/explorer-shell";
import { EmptyState } from "@/components/shared/empty-state";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { isValidMongoName } from "@/lib/domain/mongo-browser";
import { formatBytes, formatCount } from "@/lib/format";
import {
	createMongoCollection,
	deleteMongoDocument,
	dropMongoCollection,
	dropMongoDatabase,
	insertMongoDocument,
	invalidateMongo,
	useMongoCollections,
	useMongoDatabases,
	useMongoDocuments,
} from "@/lib/mongo-browser-queries";

const PAGE_SIZE = 25;

// Mongo's own databases — browsable, but the daemon refuses to mutate them (so a
// click can't drop `admin` and brick auth); hide their drop action to match.
const SYSTEM_DBS = new Set(["admin", "local", "config"]);

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function prettyJson(json: string): string {
	try {
		return JSON.stringify(JSON.parse(json), null, 2);
	} catch {
		return json;
	}
}

// The MongoDB Browser: databases drill down to collections and their documents,
// all lazily fetched from the live instance. Create databases/collections, insert
// and delete documents, with paginated document views.
export function MongoBrowser({
	eggName,
	nodeAddress,
	port,
	serverId,
	state,
}: { serverId: string } & ServerConnection) {
	const [database, setDatabase] = useState<string | null>(null);
	const [collection, setCollection] = useState<string | null>(null);

	return (
		<div className="space-y-4">
			<ConnectionHeader
				eggName={eggName}
				label="Browser"
				nodeAddress={nodeAddress}
				port={port}
				state={state}
			/>
			{database && collection ? (
				<DocumentList
					collection={collection}
					database={database}
					onBack={() => setCollection(null)}
					onRoot={() => {
						setDatabase(null);
						setCollection(null);
					}}
					serverId={serverId}
				/>
			) : database ? (
				<CollectionList
					database={database}
					onBack={() => setDatabase(null)}
					onOpen={setCollection}
					serverId={serverId}
				/>
			) : (
				<DatabaseList
					onOpen={(name) => {
						setDatabase(name);
						setCollection(null);
					}}
					serverId={serverId}
				/>
			)}
		</div>
	);
}

function DatabaseList({
	onOpen,
	serverId,
}: {
	onOpen: (name: string) => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const read = useMongoDatabases(serverId);
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
			subtitle={read?.ok ? `${databases.length} databases` : undefined}
			title="Databases"
		>
			{read && !read.ok ? (
				<div className="p-4">
					<EmptyState
						description={read.error}
						icon={FolderTree}
						title="Couldn't reach Mongo"
					/>
				</div>
			) : !read ? (
				<div className="p-8 text-center text-muted-foreground text-sm">
					Loading…
				</div>
			) : databases.length === 0 ? (
				<div className="p-4">
					<EmptyState
						description="Create a database to start storing collections."
						icon={FolderTree}
						title="No databases yet"
					/>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Database</TableHead>
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
										<FolderTree className="size-4 text-muted-foreground" />
										{database.name}
									</button>
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
										{SYSTEM_DBS.has(database.name) ? null : (
											<IconAction
												danger
												icon={Trash2}
												label={`Drop ${database.name}`}
												onClick={() => setDrop(database.name)}
											/>
										)}
									</RowActions>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<NewDatabaseDialog
				onOpenChange={setCreateOpen}
				open={createOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Drop database"
				description={`Drop the database “${drop}” and all its collections. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropMongoDatabase(serverId, drop);
						await invalidateMongo(queryClient, serverId);
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

function CollectionList({
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
	const read = useMongoCollections(serverId, database);
	const [createOpen, setCreateOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	const collections = read?.ok ? read.data : [];

	return (
		<Section
			action={
				<Button onClick={() => setCreateOpen(true)} size="sm">
					<Plus />
					New collection
				</Button>
			}
			subtitle={read?.ok ? `${collections.length} collections` : undefined}
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
						icon={FileJson}
						title="Couldn't reach Mongo"
					/>
				</div>
			) : !read ? (
				<div className="p-8 text-center text-muted-foreground text-sm">
					Loading…
				</div>
			) : collections.length === 0 ? (
				<div className="p-4">
					<EmptyState
						description="Create a collection to start storing documents."
						icon={FileJson}
						title="No collections yet"
					/>
				</div>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Collection</TableHead>
							<TableHead className="text-right">Documents</TableHead>
							<TableHead className="text-right">Size</TableHead>
							<TableHead className="text-right">Indexes</TableHead>
							<TableHead className="w-px text-right">Manage</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{collections.map((collection) => (
							<TableRow key={collection.name}>
								<TableCell>
									<button
										className="flex items-center gap-2 font-medium text-sm hover:text-primary"
										onClick={() => onOpen(collection.name)}
										type="button"
									>
										<FileJson className="size-4 text-muted-foreground" />
										{collection.name}
									</button>
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatCount(collection.documents)}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{formatBytes(collection.sizeBytes)}
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{collection.indexes}
								</TableCell>
								<TableCell className="text-right">
									<RowActions>
										<IconAction
											icon={ChevronRight}
											label={`Open ${collection.name}`}
											onClick={() => onOpen(collection.name)}
										/>
										<IconAction
											danger
											icon={Trash2}
											label={`Drop ${collection.name}`}
											onClick={() => setDrop(collection.name)}
										/>
									</RowActions>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			<NameDialog
				existing={collections.map((c) => c.name)}
				onCreate={async (collectionName) => {
					try {
						await createMongoCollection(serverId, database, collectionName);
						await invalidateMongo(queryClient, serverId);
						toast.success(`Created collection “${collectionName}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't create the collection."));
					}
				}}
				onOpenChange={setCreateOpen}
				open={createOpen}
				placeholder="invoices"
				title={`New collection in ${database}`}
			/>
			<ConfirmDrop
				confirmLabel="Drop collection"
				description={`Drop the collection “${drop}” and all its documents. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await dropMongoCollection(serverId, database, drop);
						await invalidateMongo(queryClient, serverId);
						toast.success(`Dropped collection “${drop}”.`);
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't drop the collection."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Drop this collection?"
			/>
		</Section>
	);
}

function DocumentList({
	collection,
	database,
	onBack,
	onRoot,
	serverId,
}: {
	collection: string;
	database: string;
	onBack: () => void;
	onRoot: () => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [page, setPage] = useState(0);
	const read = useMongoDocuments(
		serverId,
		database,
		collection,
		page * PAGE_SIZE,
		PAGE_SIZE
	);
	const [insertOpen, setInsertOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	// A drop/insert can shrink the collection; keep the page in range.
	const total = read?.ok ? read.data.total : 0;
	useEffect(() => {
		if (page > 0 && page * PAGE_SIZE >= total && total > 0) {
			setPage(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
		}
	}, [page, total]);

	const documents = read?.ok ? read.data.documents : [];
	const hasNext = (page + 1) * PAGE_SIZE < total;

	return (
		<Section
			action={
				<Button onClick={() => setInsertOpen(true)} size="sm">
					<Plus />
					Insert document
				</Button>
			}
			subtitle={read?.ok ? `${formatCount(total)} documents` : undefined}
			title={
				<Breadcrumb
					current={collection}
					trail={[
						{ label: "Databases", onClick: onRoot },
						{ label: database, onClick: onBack },
					]}
				/>
			}
		>
			<div className="space-y-3 p-4">
				{read && !read.ok ? (
					<EmptyState
						description={read.error}
						icon={FileJson}
						title="Couldn't reach Mongo"
					/>
				) : !read ? (
					<p className="text-center text-muted-foreground text-sm">Loading…</p>
				) : documents.length === 0 ? (
					<EmptyState
						description="Insert a document to get started."
						icon={FileJson}
						title="No documents yet"
					/>
				) : (
					<>
						{documents.map((document) => (
							<div
								className="overflow-hidden rounded-lg ring-1 ring-foreground/10"
								key={document.id}
							>
								<div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
									<span className="truncate font-mono text-muted-foreground text-xs">
										{document.id}
									</span>
									<IconAction
										danger
										icon={Trash2}
										label={`Delete document ${document.id}`}
										onClick={() => setDrop(document.id)}
									/>
								</div>
								<pre className="terminal overflow-x-auto p-3 font-mono text-xs">
									{prettyJson(document.json)}
								</pre>
							</div>
						))}
						{total > PAGE_SIZE ? (
							<div className="flex items-center justify-between pt-1">
								<span className="text-muted-foreground text-xs tabular-nums">
									{page * PAGE_SIZE + 1}–{page * PAGE_SIZE + documents.length}{" "}
									of {formatCount(total)}
								</span>
								<div className="flex gap-2">
									<Button
										disabled={page === 0}
										onClick={() => setPage((p) => Math.max(0, p - 1))}
										size="sm"
										variant="outline"
									>
										Previous
									</Button>
									<Button
										disabled={!hasNext}
										onClick={() => setPage((p) => p + 1)}
										size="sm"
										variant="outline"
									>
										Next
									</Button>
								</div>
							</div>
						) : null}
					</>
				)}
			</div>

			<InsertDocumentDialog
				collection={collection}
				database={database}
				onInserted={() => invalidateMongo(queryClient, serverId)}
				onOpenChange={setInsertOpen}
				open={insertOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Delete document"
				description={`Delete the document “${drop}”. This can't be undone.`}
				onConfirm={async () => {
					if (!drop) {
						return;
					}
					try {
						await deleteMongoDocument(serverId, database, collection, drop);
						await invalidateMongo(queryClient, serverId);
						toast.success("Deleted document.");
					} catch (e) {
						toast.error(errorMessage(e, "Couldn't delete the document."));
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Delete this document?"
			/>
		</Section>
	);
}

// A single-name create dialog (collections).
function NameDialog({
	existing,
	onCreate,
	onOpenChange,
	open,
	placeholder,
	title,
}: {
	existing: string[];
	onCreate: (name: string) => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	placeholder: string;
	title: string;
}) {
	const [name, setName] = useState("");
	const trimmed = name.trim();
	const duplicate = existing.includes(trimmed);
	const valid = isValidMongoName(trimmed) && !duplicate;

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
						onCreate(trimmed);
						onOpenChange(false);
						setName("");
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>Give the collection a name.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="mongo-name">Name</Label>
						<Input
							aria-invalid={Boolean(trimmed) && !valid}
							className="font-mono text-sm"
							id="mongo-name"
							onChange={(event) => setName(event.target.value)}
							placeholder={placeholder}
							value={name}
						/>
						{duplicate ? (
							<p className="text-destructive text-xs">
								That name is already taken.
							</p>
						) : (
							<p className="text-muted-foreground text-xs">
								Letters, numbers, dashes, and underscores.
							</p>
						)}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid} type="submit">
							Create collection
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// Creating a database needs a first collection (Mongo materializes a database when
// its first collection is created), so this dialog collects both.
function NewDatabaseDialog({
	onOpenChange,
	open,
	serverId,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [db, setDb] = useState("");
	const [coll, setColl] = useState("");
	const [busy, setBusy] = useState(false);

	function reset() {
		setDb("");
		setColl("");
	}

	const valid = isValidMongoName(db.trim()) && isValidMongoName(coll.trim());

	async function submit() {
		setBusy(true);
		try {
			await createMongoCollection(serverId, db.trim(), coll.trim());
			await invalidateMongo(queryClient, serverId);
			toast.success(`Created database “${db.trim()}”.`);
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
							Mongo creates a database with its first collection — name both.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="mongo-db">Database</Label>
							<Input
								className="font-mono text-sm"
								id="mongo-db"
								onChange={(e) => setDb(e.target.value)}
								placeholder="analytics"
								value={db}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="mongo-coll">First collection</Label>
							<Input
								className="font-mono text-sm"
								id="mongo-coll"
								onChange={(e) => setColl(e.target.value)}
								placeholder="events"
								value={coll}
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
							Create database
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function InsertDocumentDialog({
	collection,
	database,
	onInserted,
	onOpenChange,
	open,
	serverId,
}: {
	collection: string;
	database: string;
	onInserted: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);

	const trimmed = text.trim();
	let parseError = false;
	if (trimmed !== "") {
		try {
			const value = JSON.parse(trimmed);
			if (!(value && typeof value === "object" && !Array.isArray(value))) {
				parseError = true;
			}
		} catch {
			parseError = true;
		}
	}
	const valid = trimmed !== "" && !parseError;

	async function submit() {
		setBusy(true);
		try {
			await insertMongoDocument(serverId, database, collection, trimmed);
			toast.success("Inserted document.");
			onInserted();
			onOpenChange(false);
			setText("");
		} catch (e) {
			toast.error(errorMessage(e, "Couldn't insert the document."));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setText("");
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
						<DialogTitle>Insert into {collection}</DialogTitle>
						<DialogDescription>
							Paste a JSON document. An _id is generated if you leave it out.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="mongo-doc">Document</Label>
						<Textarea
							aria-invalid={parseError}
							className="min-h-32 font-mono text-xs"
							id="mongo-doc"
							onChange={(event) => setText(event.target.value)}
							placeholder={'{\n  "name": "Widget",\n  "price": 19.99\n}'}
							value={text}
						/>
						{parseError ? (
							<p className="text-destructive text-xs">
								That isn't a valid JSON object.
							</p>
						) : (
							<p className="text-muted-foreground text-xs">
								A single JSON object.
							</p>
						)}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy || !valid} type="submit">
							Insert document
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
