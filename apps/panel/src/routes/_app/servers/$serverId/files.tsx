import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Archive,
	ChevronLeft,
	ChevronRight,
	CloudDownload,
	Download,
	File as FileIcon,
	FilePlus,
	Folder,
	FolderPlus,
	House,
	KeyRound,
	Loader2,
	MoreHorizontal,
	PackageOpen,
	Pencil,
	Trash2,
	Upload,
} from "lucide-react";
import {
	type ChangeEvent,
	type DragEvent,
	useCallback,
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
import {
	ARCHIVE_FORMATS,
	type ArchiveFormat,
	archiveBaseName,
	basename,
	type FileEntry,
	fileLanguage,
	fileNameFromUrl,
	isArchive,
	isTextFile,
	joinPath,
	parentPath,
	pathOfDepth,
	segments,
	transferProgress,
	validateName,
} from "@/lib/domain/files";
import type { SftpSession } from "@/lib/domain/sftp";
import {
	archiveFiles,
	createDirectory,
	createFile,
	deleteEntry,
	extractFile,
	fileContentQueryOptions,
	fileDownloadUrl,
	invalidateFiles,
	pullUrl,
	renameEntry,
	uploadFile,
	urlJobQueryOptions,
	useFiles,
	writeFile,
} from "@/lib/file-queries";
import { formatBytes, formatRelativeTime, pluralize } from "@/lib/format";
import { useServer } from "@/lib/server-queries";
import {
	closeSftp,
	invalidateSftp,
	openSftp,
	sftpStatusQueryOptions,
} from "@/lib/sftp-queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/servers/$serverId/files")({
	component: ServerFilesTab,
});

function ServerFilesTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const [path, setPath] = useState("/");
	const [editingPath, setEditingPath] = useState<string | null>(null);

	if (!server) {
		return null;
	}

	if (server.state === "installing") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Files</CardTitle>
					<CardDescription>
						The file manager opens once this server finishes installing.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (editingPath) {
		return (
			<FileEditor
				key={editingPath}
				onClose={() => setEditingPath(null)}
				path={editingPath}
				serverId={serverId}
			/>
		);
	}

	return (
		<FileBrowser
			currentDir={path}
			onEdit={setEditingPath}
			onNavigate={setPath}
			serverId={serverId}
		/>
	);
}

// — Browser ————————————————————————————————————————————————————————————————————

type UrlJob = { id: string; name: string };

function FileBrowser({
	currentDir,
	onEdit,
	onNavigate,
	serverId,
}: {
	currentDir: string;
	onEdit: (path: string) => void;
	onNavigate: (path: string) => void;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const { data, isLoading, isError, error } = useFiles(serverId, currentDir);
	const entries = data ?? [];
	const sftpStatus = useQuery(sftpStatusQueryOptions(serverId)).data;
	const sftpActive = sftpStatus?.ok ? sftpStatus.data.active : false;

	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [dragActive, setDragActive] = useState(false);
	const [dragFolder, setDragFolder] = useState<string | null>(null);
	const [jobs, setJobs] = useState<UrlJob[]>([]);

	const [newFolderOpen, setNewFolderOpen] = useState(false);
	const [newFileOpen, setNewFileOpen] = useState(false);
	const [urlOpen, setUrlOpen] = useState(false);
	const [sftpOpen, setSftpOpen] = useState(false);
	const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
	// Paths queued for the compress dialog (selection or a single row), or null.
	const [zipSources, setZipSources] = useState<string[] | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const existingNames = new Set(entries.map((entry) => entry.name));
	const selectedHere = entries.filter((entry) => selected.has(entry.path));
	const allSelected =
		entries.length > 0 && entries.every((entry) => selected.has(entry.path));
	const someSelected = entries.some((entry) => selected.has(entry.path));

	function navigate(target: string) {
		setSelected(new Set());
		onNavigate(target);
	}

	function refresh() {
		return invalidateFiles(queryClient, serverId);
	}

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
			checked ? new Set(entries.map((entry) => entry.path)) : new Set()
		);
	}

	async function uploadFiles(fileList: FileList, dir: string) {
		const files = Array.from(fileList).filter((file) => {
			const nameError = validateName(file.name);
			if (nameError) {
				toast.error(`Can't upload “${file.name}”: ${nameError.toLowerCase()}`);
			}
			return !nameError;
		});
		if (files.length === 0) {
			return;
		}
		const dismiss = toast.loading(
			`Uploading ${pluralize(files.length, "file")}…`
		);
		try {
			await Promise.all(
				files.map((file) =>
					uploadFile(serverId, joinPath(dir, file.name), file)
				)
			);
			await refresh();
			toast.success(`Uploaded ${pluralize(files.length, "file")}.`, {
				id: dismiss,
			});
		} catch (uploadError) {
			toast.error(
				uploadError instanceof Error ? uploadError.message : "Upload failed.",
				{ id: dismiss }
			);
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
		over: (targetPath: string) => setDragFolder(targetPath),
		leave: (targetPath: string) =>
			setDragFolder((current) => (current === targetPath ? null : current)),
		drop: (event: DragEvent, targetPath: string) => {
			event.stopPropagation();
			dropFiles(event, targetPath);
		},
	};

	const startUrlJob = useCallback(
		async (url: string, name: string) => {
			try {
				const { jobId } = await pullUrl(
					serverId,
					joinPath(currentDir, name),
					url
				);
				setJobs((current) => [...current, { id: jobId, name }]);
			} catch (pullError) {
				toast.error(
					pullError instanceof Error
						? pullError.message
						: "Couldn't start the download."
				);
			}
		},
		[serverId, currentDir]
	);

	const onJobDone = useCallback(
		(id: string, name: string, state: string, jobError: string | null) => {
			setJobs((current) => current.filter((job) => job.id !== id));
			if (state === "done") {
				toast.success(`Downloaded ${name}.`);
				invalidateFiles(queryClient, serverId);
			} else if (state === "error") {
				toast.error(`Couldn't download ${name}: ${jobError ?? "failed"}.`);
			}
		},
		[queryClient, serverId]
	);

	async function remove(entry: FileEntry) {
		try {
			await deleteEntry(serverId, entry.path);
			await refresh();
			toast.success(`Deleted “${entry.name}”.`);
		} catch (deleteError) {
			toast.error(
				deleteError instanceof Error ? deleteError.message : "Couldn't delete."
			);
		}
	}

	async function bulkDelete() {
		const targets = selectedHere;
		setSelected(new Set());
		try {
			await Promise.all(
				targets.map((entry) => deleteEntry(serverId, entry.path))
			);
			await refresh();
			toast.success(`Deleted ${pluralize(targets.length, "item")}.`);
		} catch (deleteError) {
			toast.error(
				deleteError instanceof Error
					? deleteError.message
					: "Couldn't delete the selection."
			);
		}
	}

	async function compress(base: string, format: ArchiveFormat) {
		const sources = zipSources ?? [];
		const name = `${base.trim()}.${format}`;
		const dismiss = toast.loading(
			`Compressing ${pluralize(sources.length, "item")}…`
		);
		try {
			await archiveFiles(serverId, sources, joinPath(currentDir, name), format);
			setSelected(new Set());
			await refresh();
			toast.success(`Created ${name}.`, { id: dismiss });
		} catch (archiveError) {
			toast.error(
				archiveError instanceof Error
					? archiveError.message
					: "Couldn't create the archive.",
				{ id: dismiss }
			);
		}
	}

	async function extract(entry: FileEntry) {
		const folder = archiveBaseName(entry.name);
		const dismiss = toast.loading(`Extracting ${entry.name}…`);
		try {
			await extractFile(serverId, entry.path, joinPath(currentDir, folder));
			await refresh();
			toast.success(`Extracted into ${folder}/.`, { id: dismiss });
		} catch (extractError) {
			toast.error(
				extractError instanceof Error
					? extractError.message
					: "Couldn't extract the archive.",
				{ id: dismiss }
			);
		}
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
							aria-label={sftpActive ? "SFTP, session active" : undefined}
							onClick={() => setSftpOpen(true)}
							size="sm"
							variant="outline"
						>
							<KeyRound />
							SFTP
							{sftpActive ? (
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

				{jobs.length > 0 ? (
					<ActivityPanel jobs={jobs} onDone={onJobDone} serverId={serverId} />
				) : null}

				{selectedHere.length > 0 ? (
					<SelectionBar
						count={selectedHere.length}
						onClear={() => setSelected(new Set())}
						onCompress={() =>
							setZipSources(selectedHere.map((entry) => entry.path))
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
					{isLoading ? (
						<div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
							<Loader2 className="size-4 animate-spin" />
							Loading files…
						</div>
					) : isError ? (
						<div className="rounded-lg border border-warn/40 bg-warn-wash py-12 text-center text-sm text-warn-foreground">
							Couldn't reach this server's files
							{error instanceof Error ? `: ${error.message}` : "."}
						</div>
					) : entries.length === 0 ? (
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
									{entries.map((entry) => (
										<FileRow
											entry={entry}
											folderDrag={folderDrag}
											key={entry.path}
											onCompress={(target) => setZipSources([target.path])}
											onDelete={remove}
											onEdit={onEdit}
											onExtract={extract}
											onNavigate={navigate}
											onRenamed={refresh}
											onToggleSelect={toggleSelect}
											selected={selected.has(entry.path)}
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
				onSubmit={async (name) => {
					await createDirectory(serverId, joinPath(currentDir, name));
					await refresh();
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
				onSubmit={async (name) => {
					await createFile(serverId, joinPath(currentDir, name));
					await refresh();
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
					startUrlJob(url, name);
					toast.success(`Pulling ${name} from the link…`);
				}}
				open={urlOpen}
			/>
			<SftpDialog
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
				description={`Move ${pluralize(selectedHere.length, "item")} to the server's recycle bin.`}
				onConfirm={bulkDelete}
				onOpenChange={setBulkDeleteOpen}
				open={bulkDeleteOpen}
				title={`Delete ${pluralize(selectedHere.length, "item")}?`}
			/>
		</Card>
	);
}

// — Activity (URL-pull jobs) ───────────────────────────────────────────────────

function ActivityPanel({
	jobs,
	onDone,
	serverId,
}: {
	jobs: UrlJob[];
	onDone: (
		id: string,
		name: string,
		state: string,
		error: string | null
	) => void;
	serverId: string;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<div className="font-medium text-muted-foreground text-xs">Downloads</div>
			<ul className="divide-y">
				{jobs.map((job) => (
					<JobRow job={job} key={job.id} onDone={onDone} serverId={serverId} />
				))}
			</ul>
		</div>
	);
}

function JobRow({
	job,
	onDone,
	serverId,
}: {
	job: UrlJob;
	onDone: (
		id: string,
		name: string,
		state: string,
		error: string | null
	) => void;
	serverId: string;
}) {
	const { data } = useQuery(urlJobQueryOptions(serverId, job.id));
	const state = data?.state;

	useEffect(() => {
		if (state && state !== "running") {
			onDone(job.id, job.name, state, data?.error ?? null);
		}
	}, [state, job.id, job.name, data, onDone]);

	const pct = data ? transferProgress(data) : null;
	const label =
		data && data.total > 0
			? `${formatBytes(data.done)} / ${formatBytes(data.total)}`
			: data
				? formatBytes(data.done)
				: "Starting…";

	return (
		<li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
			<CloudDownload className="size-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1 space-y-1.5">
				<div className="flex items-center justify-between gap-3">
					<span className="truncate font-medium text-sm">{job.name}</span>
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{label}
					</span>
				</div>
				<UsageBar value={pct ?? 100} />
			</div>
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
	entry,
	folderDrag,
	onCompress,
	onDelete,
	onEdit,
	onExtract,
	onNavigate,
	onRenamed,
	onToggleSelect,
	selected,
	serverId,
}: {
	entry: FileEntry;
	folderDrag: FolderDrag;
	onCompress: (entry: FileEntry) => void;
	onDelete: (entry: FileEntry) => void;
	onEdit: (path: string) => void;
	onExtract: (entry: FileEntry) => void;
	onNavigate: (path: string) => void;
	onRenamed: () => void;
	onToggleSelect: (path: string) => void;
	selected: boolean;
	serverId: string;
}) {
	const isDir = entry.kind === "directory";
	const editable = isTextFile(entry);
	const dropping = folderDrag.activePath === entry.path;

	function open() {
		if (isDir) {
			onNavigate(entry.path);
		} else if (editable) {
			onEdit(entry.path);
		} else {
			triggerDownload(serverId, entry.path);
		}
	}

	const dirDrag = isDir
		? {
				onDragOver(event: DragEvent) {
					if (event.dataTransfer.types.includes("Files")) {
						event.preventDefault();
						event.stopPropagation();
						folderDrag.over(entry.path);
					}
				},
				onDragLeave(event: DragEvent) {
					event.stopPropagation();
					folderDrag.leave(entry.path);
				},
				onDrop(event: DragEvent) {
					folderDrag.drop(event, entry.path);
				},
			}
		: {};

	return (
		<TableRow className={dropping ? "bg-primary/10" : undefined} {...dirDrag}>
			<TableCell>
				<Checkbox
					aria-label={`Select ${entry.name}`}
					checked={selected}
					onCheckedChange={() => onToggleSelect(entry.path)}
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
						{entry.name}
					</span>
				</button>
			</TableCell>
			<TableCell className="text-right text-muted-foreground text-sm tabular-nums">
				{isDir ? "—" : formatBytes(entry.size)}
			</TableCell>
			<TableCell className="hidden text-right text-muted-foreground text-sm sm:table-cell">
				{formatRelativeTime(entry.modifiedAt)}
			</TableCell>
			<TableCell className="text-right">
				<FileRowActions
					editable={editable}
					entry={entry}
					onCompress={onCompress}
					onDelete={onDelete}
					onEdit={onEdit}
					onExtract={onExtract}
					onNavigate={onNavigate}
					onRenamed={onRenamed}
					serverId={serverId}
				/>
			</TableCell>
		</TableRow>
	);
}

function FileRowActions({
	editable,
	entry,
	onCompress,
	onDelete,
	onEdit,
	onExtract,
	onNavigate,
	onRenamed,
	serverId,
}: {
	editable: boolean;
	entry: FileEntry;
	onCompress: (entry: FileEntry) => void;
	onDelete: (entry: FileEntry) => void;
	onEdit: (path: string) => void;
	onExtract: (entry: FileEntry) => void;
	onNavigate: (path: string) => void;
	onRenamed: () => void;
	serverId: string;
}) {
	const isDir = entry.kind === "directory";
	const [renameOpen, setRenameOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button className="text-muted-foreground" size="icon" variant="ghost">
						<MoreHorizontal />
						<span className="sr-only">Actions for {entry.name}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{isDir ? (
						<DropdownMenuItem onClick={() => onNavigate(entry.path)}>
							Open
						</DropdownMenuItem>
					) : (
						<>
							{editable ? (
								<DropdownMenuItem onClick={() => onEdit(entry.path)}>
									<Pencil />
									Edit
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem
								onClick={() => triggerDownload(serverId, entry.path)}
							>
								<Download />
								Download
							</DropdownMenuItem>
						</>
					)}
					{isArchive(entry) ? (
						<DropdownMenuItem onClick={() => onExtract(entry)}>
							<PackageOpen />
							Extract here
						</DropdownMenuItem>
					) : null}
					<DropdownMenuItem onClick={() => onCompress(entry)}>
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
				description={`Give “${entry.name}” a new name.`}
				existingNames={new Set()}
				initialName={entry.name}
				onOpenChange={setRenameOpen}
				onSubmit={async (name) => {
					await renameEntry(
						serverId,
						entry.path,
						joinPath(parentPath(entry.path), name)
					);
					onRenamed();
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
						? `Move “${entry.name}” and everything inside it to the recycle bin.`
						: `Move “${entry.name}” to the recycle bin.`
				}
				onConfirm={() => onDelete(entry)}
				onOpenChange={setDeleteOpen}
				open={deleteOpen}
				title={`Delete ${isDir ? "folder" : "file"}?`}
			/>
		</>
	);
}

// — Editor —————————————————————————————————————————————————————————————————————

function FileEditor({
	onClose,
	path,
	serverId,
}: {
	onClose: () => void;
	path: string;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const { data, isLoading, isError, error } = useQuery(
		fileContentQueryOptions(serverId, path)
	);
	const original = data?.content ?? "";
	const [draft, setDraft] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const name = basename(path);
	const value = draft ?? original;
	const dirty = draft !== null && draft !== original;

	async function save() {
		setSaving(true);
		try {
			await writeFile(serverId, path, value);
			setDraft(null);
			await queryClient.invalidateQueries({
				queryKey: ["file-content", serverId, path],
			});
			toast.success(`Saved ${name}.`);
		} catch (saveError) {
			toast.error(
				saveError instanceof Error ? saveError.message : "Couldn't save."
			);
		} finally {
			setSaving(false);
		}
	}

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
					<CardTitle className="truncate font-mono text-base">{path}</CardTitle>
				</div>
				<Button disabled={!dirty || saving} onClick={save} size="sm">
					{saving ? "Saving…" : "Save"}
				</Button>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center gap-2 py-12 text-muted-foreground text-sm">
						<Loader2 className="size-4 animate-spin" />
						Loading…
					</div>
				) : isError ? (
					<div className="rounded-lg border border-warn/40 bg-warn-wash py-12 text-center text-sm text-warn-foreground">
						Couldn't open this file
						{error instanceof Error ? `: ${error.message}` : "."}
					</div>
				) : (
					<CodeEditor
						language={fileLanguage(name)}
						onChange={setDraft}
						value={value}
					/>
				)}
			</CardContent>

			<ConfirmDialog
				confirmLabel="Discard changes"
				description={`Your edits to “${name}” haven't been saved. Leaving now discards them.`}
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
	onSubmit: (name: string) => void | Promise<void>;
	open: boolean;
	submitLabel: string;
	title: string;
}) {
	const [name, setName] = useState(initialName);
	const [busy, setBusy] = useState(false);

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
					onSubmit={async (event) => {
						event.preventDefault();
						if (error || unchanged || busy) {
							return;
						}
						setBusy(true);
						try {
							await onSubmit(trimmed);
							onOpenChange(false);
						} catch (submitError) {
							toast.error(
								submitError instanceof Error
									? submitError.message
									: "Something went wrong."
							);
						} finally {
							setBusy(false);
						}
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
						<Button
							disabled={Boolean(error) || unchanged || busy}
							type="submit"
						>
							{submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "https:" || protocol === "http:";
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

	const urlValid = isHttpUrl(url);
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
							Paste a link and the server downloads it directly, with no need to
							download it yourself first.
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
									Enter a valid HTTP or HTTPS link.
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
								<SelectTrigger className="w-36" id="zip-format">
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

// SFTP access: mint a short-lived, per-server credential the user connects to
// with any SFTP client (sandboxed to this server's files on the box). The
// password is shown once at creation; an active session shows its username +
// expiry and can be regenerated or closed.
function SftpDialog({
	onOpenChange,
	open,
	serverId,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const status = useQuery(sftpStatusQueryOptions(serverId)).data;
	// The just-minted session (with password); cleared when the dialog reopens.
	const [minted, setMinted] = useState<SftpSession | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setMinted(null);
		}
	}, [open]);

	const active = status?.ok ? status.data : null;

	async function generate() {
		setBusy(true);
		try {
			const session = await openSftp(serverId);
			setMinted(session);
			await invalidateSftp(queryClient, serverId);
		} catch (mintError) {
			toast.error(
				mintError instanceof Error
					? mintError.message
					: "Couldn't open an SFTP session."
			);
		} finally {
			setBusy(false);
		}
	}

	async function close() {
		setBusy(true);
		try {
			await closeSftp(serverId);
			setMinted(null);
			await invalidateSftp(queryClient, serverId);
			toast.success("SFTP session closed.");
		} catch (closeError) {
			toast.error(
				closeError instanceof Error
					? closeError.message
					: "Couldn't close the session."
			);
		} finally {
			setBusy(false);
		}
	}

	const hasActive = Boolean(active?.active);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>SFTP session</DialogTitle>
					<DialogDescription>
						Connect with any SFTP client to manage this server's files in bulk.
						Credentials are per-session and expire automatically.
					</DialogDescription>
				</DialogHeader>

				{minted ? (
					<SftpCredentials session={minted} />
				) : hasActive && active ? (
					<div className="space-y-2 py-2 text-sm">
						<p className="text-muted-foreground">
							A session is active
							{active.username ? (
								<>
									{" for "}
									<span className="font-mono">{active.username}</span>
								</>
							) : null}
							{active.expiresAt
								? `, expiring ${formatRelativeTime(active.expiresAt)}`
								: ""}
							. The password is shown only when generated — regenerate to get
							new credentials.
						</p>
					</div>
				) : (
					<p className="py-2 text-muted-foreground text-sm">
						No active session. Generate credentials to connect.
					</p>
				)}

				<DialogFooter className="sm:justify-between">
					<div>
						{hasActive ? (
							<Button disabled={busy} onClick={close} variant="destructive">
								Close session
							</Button>
						) : null}
					</div>
					<div className="flex gap-2">
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Done
							</Button>
						</DialogClose>
						<Button disabled={busy} onClick={generate}>
							{hasActive || minted ? "Regenerate" : "Generate credentials"}
						</Button>
					</div>
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

function triggerDownload(serverId: string, path: string) {
	const anchor = document.createElement("a");
	anchor.href = fileDownloadUrl(serverId, path);
	anchor.rel = "noopener";
	anchor.click();
}
