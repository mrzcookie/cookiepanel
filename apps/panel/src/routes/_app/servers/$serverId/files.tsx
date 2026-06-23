import { createFileRoute } from "@tanstack/react-router";
import {
	Archive,
	ChevronLeft,
	ChevronRight,
	CloudDownload,
	Download,
	FileArchive,
	File as FileIcon,
	FilePlus,
	Folder,
	FolderPlus,
	House,
	KeyRound,
	MoreHorizontal,
	PackageOpen,
	Pencil,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import {
	type ChangeEvent,
	type DragEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/shared/code-editor";
import {
	CopyButton,
	DetailList,
	DetailRow,
} from "@/components/shared/detail-list";
import { UsageBar } from "@/components/shared/entity-card";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { FileJob } from "@/lib/domain/file-jobs";
import {
	ARCHIVE_FORMATS,
	type ArchiveFormat,
	archiveBaseName,
	basename,
	countChildren,
	type FileNode,
	fileLanguage,
	fileNameFromUrl,
	findNode,
	isArchive,
	isTextFile,
	listChildren,
	parentPath,
	pathOfDepth,
	segments,
	subtreeBytes,
	uniqueChildName,
	validateName,
} from "@/lib/domain/files";
import type { SftpSession } from "@/lib/domain/sftp";
import { formatBytes, pluralize } from "@/lib/format";
import { useServer } from "@/lib/server-queries";
import {
	dismissJob,
	startArchive,
	startExtract,
	startUpload,
	startUrlPull,
	useFileJobs,
} from "@/lib/stores/file-jobs-store";
import {
	createDirectory,
	createFile,
	deleteNode,
	deleteNodes,
	renameNode,
	useServerFiles,
	writeFile,
} from "@/lib/stores/files-store";
import {
	closeSftpSession,
	openSftpSession,
	useSftpSession,
} from "@/lib/stores/sftp-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/servers/$serverId/files")({
	component: ServerFilesTab,
});

function ServerFilesTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const nodes = useServerFiles(serverId);
	const [path, setPath] = useState("/");
	const [editingPath, setEditingPath] = useState<string | null>(null);

	if (!server) {
		return null;
	}

	// Guard against a stale path (e.g. the directory was renamed or deleted).
	const currentDir = path === "/" || findNode(nodes, path) ? path : "/";
	const editingNode = editingPath ? findNode(nodes, editingPath) : undefined;

	if (editingNode && editingNode.kind === "file") {
		return (
			<FileEditor
				key={editingNode.path}
				node={editingNode}
				onClose={() => setEditingPath(null)}
				serverId={serverId}
			/>
		);
	}

	return (
		<FileBrowser
			currentDir={currentDir}
			host={server.nodeAddress}
			nodes={nodes}
			onEdit={setEditingPath}
			onNavigate={setPath}
			serverId={serverId}
		/>
	);
}

// — Browser ————————————————————————————————————————————————————————————————————

function FileBrowser({
	currentDir,
	host,
	nodes,
	onEdit,
	onNavigate,
	serverId,
}: {
	currentDir: string;
	host: string;
	nodes: FileNode[];
	onEdit: (path: string) => void;
	onNavigate: (path: string) => void;
	serverId: string;
}) {
	const children = listChildren(nodes, currentDir);
	const jobs = useFileJobs(serverId);
	const session = useSftpSession(serverId);

	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [dragActive, setDragActive] = useState(false);
	const [dragFolder, setDragFolder] = useState<string | null>(null);

	const [newFolderOpen, setNewFolderOpen] = useState(false);
	const [newFileOpen, setNewFileOpen] = useState(false);
	const [urlOpen, setUrlOpen] = useState(false);
	const [sftpOpen, setSftpOpen] = useState(false);
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	const [zipSources, setZipSources] = useState<string[] | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Selection is scoped to the current listing — clear it when we change folder.
	function navigate(target: string) {
		setSelected(new Set());
		onNavigate(target);
	}

	// Names an in-flight job will land in `dir`, so create / upload / compress /
	// extract don't collide with a job that hasn't finished writing to the tree.
	function pendingNamesIn(dir: string) {
		return jobs
			.filter((job) => job.status === "active" && job.dir === dir)
			.map((job) => job.name);
	}

	const existingNames = new Set([
		...children.map((child) => child.name),
		...pendingNamesIn(currentDir),
	]);
	// Reconcile selection against what's actually listed, so a renamed or deleted
	// item drops out of the selection bar instead of acting on a stale path.
	const selectedHere = children.filter((child) => selected.has(child.path));
	const allSelected =
		children.length > 0 && children.every((child) => selected.has(child.path));
	const someSelected = children.some((child) => selected.has(child.path));

	function toggleSelect(targetPath: string) {
		setSelected((current) => {
			const next = new Set(current);
			if (next.has(targetPath)) {
				next.delete(targetPath);
			} else {
				next.add(targetPath);
			}
			return next;
		});
	}

	function toggleSelectAll(checked: boolean) {
		setSelected(
			checked ? new Set(children.map((child) => child.path)) : new Set()
		);
	}

	function uploadFiles(fileList: FileList, dir: string) {
		const taken = new Set([
			...listChildren(nodes, dir).map((child) => child.name),
			...pendingNamesIn(dir),
		]);
		let started = 0;
		for (const file of Array.from(fileList)) {
			const nameError = validateName(file.name);
			if (nameError) {
				toast.error(`Can't upload “${file.name}”: ${nameError.toLowerCase()}`);
				continue;
			}
			if (taken.has(file.name)) {
				toast.error(`“${file.name}” already exists in that folder.`);
				continue;
			}
			taken.add(file.name);
			startUpload(serverId, dir, file);
			started += 1;
		}
		if (started > 0) {
			toast.success(`Uploading ${pluralize(started, "file")}…`);
		}
	}

	function onUploadInput(event: ChangeEvent<HTMLInputElement>) {
		const { files } = event.target;
		event.target.value = "";
		if (files && files.length > 0) {
			uploadFiles(files, currentDir);
		}
	}

	function dropFiles(event: DragEvent, dir: string) {
		event.preventDefault();
		setDragActive(false);
		setDragFolder(null);
		const { files } = event.dataTransfer;
		if (files && files.length > 0) {
			uploadFiles(files, dir);
		}
	}

	const folderDrag = {
		activePath: dragFolder,
		over(targetPath: string) {
			setDragFolder(targetPath);
		},
		leave(targetPath: string) {
			setDragFolder((current) => (current === targetPath ? null : current));
		},
		drop(event: DragEvent, targetPath: string) {
			event.stopPropagation();
			dropFiles(event, targetPath);
		},
	};

	function compress(base: string, format: ArchiveFormat) {
		const sources = zipSources ?? [];
		const name = uniqueChildName(
			nodes,
			currentDir,
			`${base.trim()}.${format}`,
			pendingNamesIn(currentDir)
		);
		const total = sources.reduce(
			(sum, source) => sum + subtreeBytes(nodes, source),
			0
		);
		startArchive(
			serverId,
			currentDir,
			name,
			Math.max(1024, Math.round(total * 0.6))
		);
		setSelected(new Set());
		toast.success(
			`Compressing ${pluralize(sources.length, "item")} into ${name}…`
		);
	}

	function extract(node: FileNode) {
		// The output folder is derived from the archive name, so run it through the
		// same name guard the other write paths use (an archive named "..tar" would
		// otherwise yield a "." folder). Fall back to a safe default.
		const base = archiveBaseName(node.name);
		const safeBase = validateName(base) ? "extracted" : base;
		const folderName = uniqueChildName(
			nodes,
			currentDir,
			safeBase,
			pendingNamesIn(currentDir)
		);
		startExtract(
			serverId,
			currentDir,
			folderName,
			node.name,
			Math.max(1024, Math.round(node.size * 1.4))
		);
		toast.success(`Extracting ${node.name}…`);
	}

	function bulkDelete() {
		const paths = selectedHere.map((child) => child.path);
		deleteNodes(serverId, paths);
		setSelected(new Set());
		toast.success(`Deleted ${pluralize(paths.length, "item")}.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Files</CardTitle>
				<CardDescription>
					Browse, edit, and upload files on this server's data volume.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<Breadcrumbs currentDir={currentDir} onNavigate={navigate} />
					<div className="flex flex-wrap items-center gap-2">
						<input
							className="hidden"
							multiple
							onChange={onUploadInput}
							ref={fileInputRef}
							type="file"
						/>
						<Button
							aria-label={session ? "SFTP, session active" : undefined}
							onClick={() => setSftpOpen(true)}
							size="sm"
							variant="outline"
						>
							<KeyRound />
							SFTP
							{session ? (
								<>
									<span
										aria-hidden
										className="size-2 shrink-0 rounded-full bg-ok"
									/>
									<span className="sr-only">session active</span>
								</>
							) : null}
						</Button>
						<Button
							onClick={() => fileInputRef.current?.click()}
							size="sm"
							variant="outline"
						>
							<Upload />
							Upload
						</Button>
						<Button
							onClick={() => setUrlOpen(true)}
							size="sm"
							variant="outline"
						>
							<CloudDownload />
							From URL
						</Button>
						<Button
							onClick={() => setNewFolderOpen(true)}
							size="sm"
							variant="outline"
						>
							<FolderPlus />
							New folder
						</Button>
						<Button onClick={() => setNewFileOpen(true)} size="sm">
							<FilePlus />
							New file
						</Button>
					</div>
				</div>

				{jobs.length > 0 ? <ActivityPanel jobs={jobs} /> : null}

				{selectedHere.length > 0 ? (
					<SelectionBar
						count={selectedHere.length}
						onClear={() => setSelected(new Set())}
						onCompress={() =>
							setZipSources(selectedHere.map((child) => child.path))
						}
						onDelete={() => setBulkDeleteOpen(true)}
					/>
				) : null}

				{/* biome-ignore lint/a11y/noStaticElementInteractions: a mouse-only drag-and-drop drop zone (the Upload button is the keyboard-accessible equivalent). No honest ARIA role removes this: every role that silences it — group, region, figure — trips useSemanticElements instead, and presentation/none don't silence it. */}
				<div
					className={cn(
						"rounded-xl transition-colors",
						dragActive && !dragFolder && "ring-2 ring-primary/60"
					)}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node)) {
							setDragActive(false);
							setDragFolder(null);
						}
					}}
					onDragOver={(event) => {
						if (event.dataTransfer.types.includes("Files")) {
							event.preventDefault();
							setDragActive(true);
						}
					}}
					onDrop={(event) => dropFiles(event, currentDir)}
				>
					{children.length === 0 ? (
						<div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground text-sm">
							This folder is empty. Drop files here to upload.
						</div>
					) : (
						<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-10">
											<Checkbox
												aria-label="Select all"
												checked={
													allSelected
														? true
														: someSelected
															? "indeterminate"
															: false
												}
												onCheckedChange={(checked) =>
													toggleSelectAll(checked === true)
												}
											/>
										</TableHead>
										<TableHead>Name</TableHead>
										<TableHead className="text-right">Size</TableHead>
										<TableHead className="hidden text-right sm:table-cell">
											Modified
										</TableHead>
										<TableHead className="w-10" />
									</TableRow>
								</TableHeader>
								<TableBody>
									{children.map((node) => (
										<FileRow
											folderDrag={folderDrag}
											key={node.path}
											node={node}
											nodes={nodes}
											onCompress={(target) => setZipSources([target.path])}
											onEdit={onEdit}
											onExtract={extract}
											onNavigate={navigate}
											onToggleSelect={toggleSelect}
											selected={selected.has(node.path)}
											serverId={serverId}
										/>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</div>
			</CardContent>

			<NameDialog
				description="Create a new folder in this directory."
				existingNames={existingNames}
				onOpenChange={setNewFolderOpen}
				onSubmit={(name) => {
					createDirectory(serverId, currentDir, name);
					toast.success(`Created folder “${name}”.`);
				}}
				open={newFolderOpen}
				submitLabel="Create folder"
				title="New folder"
			/>
			<NameDialog
				description="Create a new empty file in this directory."
				existingNames={existingNames}
				onOpenChange={setNewFileOpen}
				onSubmit={(name) => {
					createFile(serverId, currentDir, name);
					toast.success(`Created file “${name}”.`);
				}}
				open={newFileOpen}
				submitLabel="Create file"
				title="New file"
			/>
			<UrlDialog
				existingNames={existingNames}
				onOpenChange={setUrlOpen}
				onSubmit={(url, name) => {
					startUrlPull(serverId, currentDir, url, name);
					toast.success(`Pulling ${name} from the link…`);
				}}
				open={urlOpen}
			/>
			<SftpDialog
				host={host}
				onOpenChange={setSftpOpen}
				open={sftpOpen}
				serverId={serverId}
			/>
			<ZipDialog
				onConfirm={compress}
				onOpenChange={(open) => setZipSources(open ? zipSources : null)}
				sources={zipSources}
			/>
			<ConfirmDialog
				confirmLabel="Delete"
				description={`Permanently delete ${pluralize(selectedHere.length, "item")} from this folder. This can't be undone.`}
				onConfirm={bulkDelete}
				onOpenChange={setBulkDeleteOpen}
				open={bulkDeleteOpen}
				title={`Delete ${pluralize(selectedHere.length, "item")}?`}
			/>
		</Card>
	);
}

// — Activity (jobs) ————————————————————————————————————————————————————————————

const JOB_VERB: Record<FileJob["kind"], [string, string]> = {
	upload: ["Uploading", "Uploaded"],
	url: ["Downloading", "Downloaded"],
	archive: ["Compressing", "Compressed"],
	extract: ["Extracting", "Extracted"],
};

const JOB_ICON = {
	upload: Upload,
	url: CloudDownload,
	archive: FileArchive,
	extract: PackageOpen,
} as const;

function ActivityPanel({ jobs }: { jobs: FileJob[] }) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<div className="font-medium text-muted-foreground text-xs">Activity</div>
			<ul className="divide-y">
				{jobs.map((job) => (
					<JobRow job={job} key={job.id} />
				))}
			</ul>
		</div>
	);
}

function JobRow({ job }: { job: FileJob }) {
	const Icon = JOB_ICON[job.kind];
	const [active, done] = JOB_VERB[job.kind];
	const label =
		job.status === "failed"
			? "Failed"
			: job.status === "completed"
				? done
				: `${active} · ${job.progress}%`;

	return (
		<li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
			<Icon className="size-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1 space-y-1.5">
				<div className="flex items-center justify-between gap-3">
					<span className="truncate font-medium text-sm">{job.name}</span>
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{label}
					</span>
				</div>
				<UsageBar stressed={job.status === "failed"} value={job.progress} />
			</div>
			<Button
				className="size-7 shrink-0 text-muted-foreground"
				onClick={() => dismissJob(job.id)}
				size="icon"
				variant="ghost"
			>
				<X />
				<span className="sr-only">Dismiss {job.name}</span>
			</Button>
		</li>
	);
}

function SelectionBar({
	count,
	onClear,
	onCompress,
	onDelete,
}: {
	count: number;
	onClear: () => void;
	onCompress: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
			<span className="font-medium text-sm">
				{pluralize(count, "item")} selected
			</span>
			<div className="flex items-center gap-2">
				<Button onClick={onCompress} size="sm" variant="outline">
					<Archive />
					Compress
				</Button>
				<Button onClick={onDelete} size="sm" variant="outline">
					<Trash2 />
					Delete
				</Button>
				<Button onClick={onClear} size="sm" variant="ghost">
					Clear
				</Button>
			</div>
		</div>
	);
}

function Breadcrumbs({
	currentDir,
	onNavigate,
}: {
	currentDir: string;
	onNavigate: (path: string) => void;
}) {
	const parts = segments(currentDir);

	return (
		<nav
			aria-label="Folder path"
			className="flex min-w-0 flex-wrap items-center gap-1 text-sm"
		>
			<button
				className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
				disabled={currentDir === "/"}
				onClick={() => onNavigate("/")}
				type="button"
			>
				<House className="size-4" />
				<span className="sr-only">Home</span>
			</button>
			{parts.map((part, index) => {
				const target = pathOfDepth(currentDir, index + 1);
				const isLast = index === parts.length - 1;
				return (
					<span className="flex items-center gap-1" key={target}>
						<ChevronRight className="size-3.5 text-muted-foreground" />
						{isLast ? (
							<span
								aria-current="page"
								className="max-w-40 truncate font-medium"
							>
								{part}
							</span>
						) : (
							<button
								className="max-w-40 truncate rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
								onClick={() => onNavigate(target)}
								type="button"
							>
								{part}
							</button>
						)}
					</span>
				);
			})}
		</nav>
	);
}

type FolderDrag = {
	activePath: string | null;
	over: (path: string) => void;
	leave: (path: string) => void;
	drop: (event: DragEvent, path: string) => void;
};

function FileRow({
	folderDrag,
	node,
	nodes,
	onCompress,
	onEdit,
	onExtract,
	onNavigate,
	onToggleSelect,
	selected,
	serverId,
}: {
	folderDrag: FolderDrag;
	node: FileNode;
	nodes: FileNode[];
	onCompress: (node: FileNode) => void;
	onEdit: (path: string) => void;
	onExtract: (node: FileNode) => void;
	onNavigate: (path: string) => void;
	onToggleSelect: (path: string) => void;
	selected: boolean;
	serverId: string;
}) {
	const isDir = node.kind === "directory";
	const editable = isTextFile(node);
	const dropping = folderDrag.activePath === node.path;

	function open() {
		if (isDir) {
			onNavigate(node.path);
		} else if (editable) {
			onEdit(node.path);
		} else {
			download(node);
		}
	}

	const dirDrag = isDir
		? {
				onDragOver(event: DragEvent) {
					if (event.dataTransfer.types.includes("Files")) {
						event.preventDefault();
						event.stopPropagation();
						folderDrag.over(node.path);
					}
				},
				onDragLeave(event: DragEvent) {
					event.stopPropagation();
					folderDrag.leave(node.path);
				},
				onDrop(event: DragEvent) {
					folderDrag.drop(event, node.path);
				},
			}
		: {};

	return (
		<TableRow className={dropping ? "bg-primary/10" : undefined} {...dirDrag}>
			<TableCell>
				<Checkbox
					aria-label={`Select ${node.name}`}
					checked={selected}
					onCheckedChange={() => onToggleSelect(node.path)}
				/>
			</TableCell>
			<TableCell>
				<button
					className="flex min-w-0 items-center gap-2.5 text-left"
					onClick={open}
					type="button"
				>
					<span className="text-muted-foreground">
						{isDir ? (
							<Folder className="size-4" strokeWidth={1.75} />
						) : (
							<FileIcon className="size-4" strokeWidth={1.75} />
						)}
					</span>
					<span className="truncate font-medium text-sm hover:underline">
						{node.name}
					</span>
				</button>
			</TableCell>
			<TableCell className="text-right text-muted-foreground text-sm tabular-nums">
				{sizeLabel(nodes, node)}
			</TableCell>
			<TableCell className="hidden text-right text-muted-foreground text-sm sm:table-cell">
				{node.modifiedAt}
			</TableCell>
			<TableCell className="text-right">
				<FileRowActions
					editable={editable}
					node={node}
					nodes={nodes}
					onCompress={onCompress}
					onEdit={onEdit}
					onExtract={onExtract}
					onNavigate={onNavigate}
					serverId={serverId}
				/>
			</TableCell>
		</TableRow>
	);
}

function FileRowActions({
	editable,
	node,
	nodes,
	onCompress,
	onEdit,
	onExtract,
	onNavigate,
	serverId,
}: {
	editable: boolean;
	node: FileNode;
	nodes: FileNode[];
	onCompress: (node: FileNode) => void;
	onEdit: (path: string) => void;
	onExtract: (node: FileNode) => void;
	onNavigate: (path: string) => void;
	serverId: string;
}) {
	const isDir = node.kind === "directory";
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// Names already used in this node's directory — a rename can't collide.
	const siblingNames = new Set(
		listChildren(nodes, parentPath(node.path)).map((sibling) => sibling.name)
	);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button className="text-muted-foreground" size="icon" variant="ghost">
						<MoreHorizontal />
						<span className="sr-only">Actions for {node.name}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{isDir ? (
						<DropdownMenuItem onClick={() => onNavigate(node.path)}>
							Open
						</DropdownMenuItem>
					) : (
						<>
							{editable ? (
								<DropdownMenuItem onClick={() => onEdit(node.path)}>
									<Pencil />
									Edit
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem onClick={() => download(node)}>
								<Download />
								Download
							</DropdownMenuItem>
						</>
					)}
					{isArchive(node) ? (
						<DropdownMenuItem onClick={() => onExtract(node)}>
							<PackageOpen />
							Extract here
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem onClick={() => onCompress(node)}>
						<Archive />
						Compress…
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => setRenameOpen(true)}>
						<Pencil />
						Rename
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setDeleteOpen(true)}
						variant="destructive"
					>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<NameDialog
				description={`Give “${node.name}” a new name.`}
				existingNames={siblingNames}
				initialName={node.name}
				onOpenChange={setRenameOpen}
				onSubmit={(name) => {
					renameNode(serverId, node.path, name);
					toast.success(`Renamed to “${name}”.`);
				}}
				open={renameOpen}
				submitLabel="Rename"
				title={isDir ? "Rename folder" : "Rename file"}
			/>
			<ConfirmDialog
				confirmLabel="Delete"
				description={
					isDir
						? `Permanently delete “${node.name}” and everything inside it. This can't be undone.`
						: `Permanently delete “${node.name}”. This can't be undone.`
				}
				onConfirm={() => {
					deleteNode(serverId, node.path);
					toast.success(`Deleted “${node.name}”.`);
				}}
				onOpenChange={setDeleteOpen}
				open={deleteOpen}
				title={`Delete ${isDir ? "folder" : "file"}?`}
			/>
		</>
	);
}

// — Editor —————————————————————————————————————————————————————————————————————

function FileEditor({
	node,
	onClose,
	serverId,
}: {
	node: FileNode;
	onClose: () => void;
	serverId: string;
}) {
	const [draft, setDraft] = useState(node.content ?? "");
	const [confirmOpen, setConfirmOpen] = useState(false);
	const dirty = draft !== (node.content ?? "");

	function save() {
		writeFile(serverId, node.path, draft);
		toast.success(`Saved ${node.name}.`);
	}

	// Guard the back button so unsaved edits aren't lost to an accidental click.
	function close() {
		if (dirty) {
			setConfirmOpen(true);
		} else {
			onClose();
		}
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<button
						className="inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
						onClick={close}
						type="button"
					>
						<ChevronLeft className="size-4" />
						Files
					</button>
					<CardTitle className="truncate font-mono text-base">
						{node.path}
					</CardTitle>
				</div>
				<Button disabled={!dirty} onClick={save} size="sm">
					Save
				</Button>
			</CardHeader>
			<CardContent>
				<CodeEditor
					language={fileLanguage(node.name)}
					onChange={setDraft}
					value={draft}
				/>
			</CardContent>

			<ConfirmDialog
				confirmLabel="Discard changes"
				description={`Your edits to “${node.name}” haven't been saved. Leaving now discards them.`}
				onConfirm={onClose}
				onOpenChange={setConfirmOpen}
				open={confirmOpen}
				title="Discard unsaved changes?"
			/>
		</Card>
	);
}

// — Dialogs ————————————————————————————————————————————————————————————————————

function NameDialog({
	description,
	existingNames,
	initialName = "",
	onOpenChange,
	onSubmit,
	open,
	submitLabel,
	title,
}: {
	description: string;
	existingNames: Set<string>;
	initialName?: string;
	onOpenChange: (open: boolean) => void;
	onSubmit: (name: string) => void;
	open: boolean;
	submitLabel: string;
	title: string;
}) {
	const [name, setName] = useState(initialName);

	// Re-seed each time the dialog opens, so a cancelled edit doesn't linger.
	useEffect(() => {
		if (open) {
			setName(initialName);
		}
	}, [open, initialName]);

	const trimmed = name.trim();
	const duplicate =
		trimmed !== initialName && existingNames.has(trimmed)
			? "Something with that name already exists here."
			: null;
	const error = validateName(name) ?? duplicate;
	const unchanged = trimmed === initialName;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (error || unchanged) {
							return;
						}
						onSubmit(trimmed);
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="file-name">Name</Label>
						<Input
							autoFocus
							className="font-mono"
							id="file-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						{name.trim() !== "" && error ? (
							<p className="text-destructive text-xs">{error}</p>
						) : null}
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={Boolean(error) || unchanged} type="submit">
							{submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function UrlDialog({
	existingNames,
	onOpenChange,
	onSubmit,
	open,
}: {
	existingNames: Set<string>;
	onOpenChange: (open: boolean) => void;
	onSubmit: (url: string, name: string) => void;
	open: boolean;
}) {
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
	const [nameEdited, setNameEdited] = useState(false);

	useEffect(() => {
		if (open) {
			setUrl("");
			setName("");
			setNameEdited(false);
		}
	}, [open]);

	const urlValid = isHttpsUrl(url);
	const trimmed = name.trim();
	const nameError =
		validateName(name) ??
		(existingNames.has(trimmed)
			? "Something with that name already exists here."
			: null);
	const canSubmit = urlValid && !nameError;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (!canSubmit) {
							return;
						}
						onSubmit(url.trim(), trimmed);
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Pull from a link</DialogTitle>
						<DialogDescription>
							Paste an HTTPS link and the server downloads it directly, with no
							need to download it yourself first.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="url-source">Link</Label>
							<Input
								autoFocus
								className="font-mono text-sm"
								id="url-source"
								onChange={(event) => {
									const value = event.target.value;
									setUrl(value);
									if (!nameEdited) {
										setName(value ? fileNameFromUrl(value) : "");
									}
								}}
								placeholder="https://example.com/file.zip"
								value={url}
							/>
							{url !== "" && !urlValid ? (
								<p className="text-destructive text-xs">
									Enter a valid HTTPS link.
								</p>
							) : null}
						</div>
						<div className="grid gap-2">
							<Label htmlFor="url-name">Save as</Label>
							<Input
								className="font-mono"
								id="url-name"
								onChange={(event) => {
									setName(event.target.value);
									setNameEdited(true);
								}}
								value={name}
							/>
							{trimmed !== "" && nameError ? (
								<p className="text-destructive text-xs">{nameError}</p>
							) : null}
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!canSubmit} type="submit">
							Download
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ZipDialog({
	onConfirm,
	onOpenChange,
	sources,
}: {
	onConfirm: (base: string, format: ArchiveFormat) => void;
	onOpenChange: (open: boolean) => void;
	sources: string[] | null;
}) {
	const open = sources !== null;
	const single = sources?.length === 1 ? sources[0] : null;
	const [base, setBase] = useState("archive");
	const [format, setFormat] = useState<ArchiveFormat>("zip");

	useEffect(() => {
		if (open) {
			setBase(single ? basename(single) : "archive");
			setFormat("zip");
		}
	}, [open, single]);

	const error = validateName(base);
	const count = sources?.length ?? 0;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (error) {
							return;
						}
						onConfirm(base.trim(), format);
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Compress {pluralize(count, "item")}</DialogTitle>
						<DialogDescription>
							Create an archive in the current folder.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-end">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="zip-name">Archive name</Label>
							<Input
								autoFocus
								className="font-mono"
								id="zip-name"
								onChange={(event) => setBase(event.target.value)}
								value={base}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="zip-format">Format</Label>
							<Select
								onValueChange={(value) => setFormat(value as ArchiveFormat)}
								value={format}
							>
								<SelectTrigger className="w-28" id="zip-format">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ARCHIVE_FORMATS.map((option) => (
										<SelectItem key={option} value={option}>
											.{option}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					{base.trim() !== "" && error ? (
						<p className="-mt-2 pb-2 text-destructive text-xs">{error}</p>
					) : null}
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={Boolean(error)} type="submit">
							Compress
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function SftpDialog({
	host,
	onOpenChange,
	open,
	serverId,
}: {
	host: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const session = useSftpSession(serverId);

	// Opening the dialog with no live session mints one (new credentials each
	// time). An existing session is shown as-is — closing it revokes the access.
	useEffect(() => {
		if (open && !session) {
			openSftpSession(serverId, host);
		}
	}, [open, session, serverId, host]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>SFTP session</DialogTitle>
					<DialogDescription>
						Connect with any SFTP client to upload files. These credentials are
						single-use and stay valid until you close the session.
					</DialogDescription>
				</DialogHeader>
				{session ? <SftpCredentials session={session} /> : null}
				<DialogFooter>
					<Button
						onClick={() => {
							closeSftpSession(serverId);
							onOpenChange(false);
						}}
						variant="destructive"
					>
						Close session
					</Button>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Done
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SftpCredentials({ session }: { session: SftpSession }) {
	const command = `sftp -P ${session.port} ${session.username}@${session.host}`;
	return (
		<div className="space-y-3 py-2">
			<DetailList>
				<DetailRow copyable label="Host" value={session.host} wrap />
				<DetailRow label="Port" value={String(session.port)} />
				<DetailRow copyable label="Username" value={session.username} wrap />
				<DetailRow copyable label="Password" value={session.password} wrap />
			</DetailList>
			<div className="flex items-start gap-1 rounded-lg bg-muted/50 px-3 py-2">
				<span className="min-w-0 flex-1 break-all font-mono text-xs">
					{command}
				</span>
				<CopyButton label="SFTP command" value={command} />
			</div>
		</div>
	);
}

function ConfirmDialog({
	confirmLabel,
	description,
	onConfirm,
	onOpenChange,
	open,
	title,
}: {
	confirmLabel: string;
	description: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
						variant="destructive"
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// — Helpers ————————————————————————————————————————————————————————————————————

function sizeLabel(nodes: FileNode[], node: FileNode): ReactNode {
	if (node.kind === "directory") {
		const count = countChildren(nodes, node.path);
		return count === 0 ? "empty" : pluralize(count, "item");
	}
	return formatBytes(node.size);
}

function download(node: FileNode) {
	if (node.content === undefined) {
		toast.info("Downloading this file isn't available in the demo.");
		return;
	}
	const blob = new Blob([node.content], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = node.name;
	anchor.click();
	URL.revokeObjectURL(url);
	toast.success(`Downloading ${node.name}.`);
}
