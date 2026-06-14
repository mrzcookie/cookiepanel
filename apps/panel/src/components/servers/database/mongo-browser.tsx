import { ChevronRight, FileJson, FolderTree, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import {
	Breadcrumb,
	ConfirmDrop,
	ConnectionHeader,
	IconAction,
	RowActions,
	Section,
} from "@/components/servers/database/explorer-shell";
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
import { formatBytes, formatCount, pluralize } from "@/lib/format";
import {
	databaseSize,
	isValidMongoName,
	type MongoCollection,
	type MongoData,
	type MongoDatabase,
} from "@/lib/mongo-browser";
import {
	createCollection,
	createDatabase,
	deleteDocument,
	dropCollection,
	dropDatabase,
	insertDocument,
	useMongoData,
} from "@/lib/mongo-browser-store";
import type { ServerRow } from "@/lib/stubs";

function objectId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

// The MongoDB Document Browser: databases drill down to collections and their
// documents (JSON). Create and drop databases / collections, and insert or
// delete documents, against the stub store.
export function MongoBrowser({ server }: { server: ServerRow }) {
	const data = useMongoData(server.id);
	const [database, setDatabase] = useState<string | null>(null);
	const [collection, setCollection] = useState<string | null>(null);

	const db = database
		? data.databases.find((item) => item.name === database)
		: undefined;
	const coll =
		db && collection
			? db.collections.find((item) => item.name === collection)
			: undefined;

	return (
		<div className="space-y-4">
			<ConnectionHeader label="Browser" server={server} />
			{db && coll ? (
				<DocumentList
					collection={coll}
					databaseName={db.name}
					onBack={() => setCollection(null)}
					onRoot={() => {
						setDatabase(null);
						setCollection(null);
					}}
					serverId={server.id}
				/>
			) : db ? (
				<CollectionList
					database={db}
					onBack={() => setDatabase(null)}
					onOpen={setCollection}
					serverId={server.id}
				/>
			) : (
				<DatabaseList
					data={data}
					onOpen={(name) => {
						setDatabase(name);
						setCollection(null);
					}}
					serverId={server.id}
				/>
			)}
		</div>
	);
}

function DatabaseList({
	data,
	onOpen,
	serverId,
}: {
	data: MongoData;
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
							<TableHead className="text-right">Collections</TableHead>
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
										<FolderTree className="size-4 text-muted-foreground" />
										{database.name}
									</button>
								</TableCell>
								<TableCell className="text-right font-mono text-muted-foreground tabular-nums">
									{database.collections.length}
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

			<NameDialog
				existing={data.databases.map((database) => database.name)}
				label="database"
				onCreate={(name) => {
					createDatabase(serverId, name);
					toast.success(`Created database “${name}”.`);
				}}
				onOpenChange={setCreateOpen}
				open={createOpen}
				placeholder="analytics"
				title="New database"
			/>
			<ConfirmDrop
				confirmLabel="Drop database"
				description={`Drop the database “${drop}” and all its collections. This can't be undone.`}
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

function CollectionList({
	database,
	onBack,
	onOpen,
	serverId,
}: {
	database: MongoDatabase;
	onBack: () => void;
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
					New collection
				</Button>
			}
			subtitle={pluralize(database.collections.length, "collection")}
			title={
				<Breadcrumb
					current={database.name}
					trail={[{ label: "Databases", onClick: onBack }]}
				/>
			}
		>
			{database.collections.length === 0 ? (
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
						{database.collections.map((collection) => (
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
				existing={database.collections.map((collection) => collection.name)}
				label="collection"
				onCreate={(name) => {
					createCollection(serverId, database.name, name);
					toast.success(`Created collection “${name}”.`);
				}}
				onOpenChange={setCreateOpen}
				open={createOpen}
				placeholder="invoices"
				title={`New collection in ${database.name}`}
			/>
			<ConfirmDrop
				confirmLabel="Drop collection"
				description={`Drop the collection “${drop}” and all its documents. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						dropCollection(serverId, database.name, drop);
						toast.success(`Dropped collection “${drop}”.`);
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
	databaseName,
	onBack,
	onRoot,
	serverId,
}: {
	collection: MongoCollection;
	databaseName: string;
	onBack: () => void;
	onRoot: () => void;
	serverId: string;
}) {
	const [insertOpen, setInsertOpen] = useState(false);
	const [drop, setDrop] = useState<string | null>(null);

	return (
		<Section
			action={
				<Button onClick={() => setInsertOpen(true)} size="sm">
					<Plus />
					Insert document
				</Button>
			}
			subtitle={`${formatCount(collection.documents)} documents · ${formatBytes(collection.sizeBytes)}`}
			title={
				<Breadcrumb
					current={collection.name}
					trail={[
						{ label: "Databases", onClick: onRoot },
						{ label: databaseName, onClick: onBack },
					]}
				/>
			}
		>
			<div className="space-y-3 p-4">
				{collection.sample.length === 0 ? (
					<EmptyState
						description="Insert a document to get started."
						icon={FileJson}
						title="No documents yet"
					/>
				) : (
					<>
						<p className="text-muted-foreground text-xs">
							Showing {collection.sample.length} of{" "}
							{formatCount(collection.documents)} documents.
						</p>
						{collection.sample.map((document) => (
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
									{document.json}
								</pre>
							</div>
						))}
					</>
				)}
			</div>

			<InsertDocumentDialog
				collectionName={collection.name}
				databaseName={databaseName}
				existingIds={collection.sample.map((document) => document.id)}
				onOpenChange={setInsertOpen}
				open={insertOpen}
				serverId={serverId}
			/>
			<ConfirmDrop
				confirmLabel="Delete document"
				description={`Delete the document “${drop}”. This can't be undone.`}
				onConfirm={() => {
					if (drop) {
						deleteDocument(serverId, databaseName, collection.name, drop);
						toast.success("Deleted document.");
					}
				}}
				onOpenChange={(next) => setDrop(next ? drop : null)}
				open={drop !== null}
				title="Delete this document?"
			/>
		</Section>
	);
}

// A shared name-only create dialog (databases + collections).
function NameDialog({
	existing,
	label,
	onCreate,
	onOpenChange,
	open,
	placeholder,
	title,
}: {
	existing: string[];
	label: string;
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
						<DialogDescription>Give the {label} a name.</DialogDescription>
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
							Create {label}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function InsertDocumentDialog({
	collectionName,
	databaseName,
	existingIds,
	onOpenChange,
	open,
	serverId,
}: {
	collectionName: string;
	databaseName: string;
	existingIds: string[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [text, setText] = useState("");

	const trimmed = text.trim();
	let parsed: Record<string, unknown> | null = null;
	let parseError = false;
	if (trimmed !== "") {
		try {
			const value = JSON.parse(trimmed);
			if (value && typeof value === "object" && !Array.isArray(value)) {
				parsed = value as Record<string, unknown>;
			} else {
				parseError = true;
			}
		} catch {
			parseError = true;
		}
	}
	const valid = parsed !== null;

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
						if (!parsed) {
							return;
						}
						const { _id, ...body } = parsed;
						// Honor a supplied _id only when it's a usable, unique string;
						// otherwise mint one (a real driver rejects a duplicate _id).
						const id =
							typeof _id === "string" &&
							_id !== "" &&
							!existingIds.includes(_id)
								? _id
								: objectId();
						insertDocument(serverId, databaseName, collectionName, {
							id,
							json: JSON.stringify({ _id: id, ...body }, null, 2),
						});
						toast.success("Inserted document.");
						onOpenChange(false);
						setText("");
					}}
				>
					<DialogHeader>
						<DialogTitle>Insert into {collectionName}</DialogTitle>
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
						<Button disabled={!valid} type="submit">
							Insert document
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
