// File-manager domain types + pure, client-safe helpers.
//
// A server's files live on its data volume on the node — daemon-derived, like
// servers and networks (a stub store in the UI-first phase; see files-store.ts).
// Paths are POSIX, absolute within the volume, and rooted at "/" (the volume
// root the daemon sandboxes to — there is no "above" root). This module is pure:
// no stub data, no React.

export type FileKind = "file" | "directory";

export type FileNode = {
	/** Absolute path within the volume, e.g. "/world/level.dat". Root is "/". */
	path: string;
	/** Basename — the last path segment. */
	name: string;
	kind: FileKind;
	/** Size in bytes. Directories report 0 (the UI shows an item count instead). */
	size: number;
	/** Pre-formatted modified time for the UI-first phase. */
	modifiedAt: string;
	/** Editable UTF-8 text for text files; undefined for directories and binary
	 * files (which can be downloaded but not opened in the editor). */
	content?: string;
};

/** The parent directory of a path. parentPath("/world/level.dat") → "/world";
 * a root-level path or "/" itself → "/". */
export function parentPath(path: string): string {
	const i = path.lastIndexOf("/");
	return i <= 0 ? "/" : path.slice(0, i);
}

/** The direct children of `dirPath`, directories first, then case-insensitive
 * by name — the order the listing renders. */
export function listChildren(nodes: FileNode[], dirPath: string): FileNode[] {
	return nodes
		.filter((node) => parentPath(node.path) === dirPath)
		.sort((a, b) => {
			if (a.kind !== b.kind) {
				return a.kind === "directory" ? -1 : 1;
			}
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});
}

/** The node at an exact path, or undefined. */
export function findNode(
	nodes: FileNode[],
	path: string
): FileNode | undefined {
	return nodes.find((node) => node.path === path);
}

/** Number of direct children under `dirPath` (shown as a directory's "size"). */
export function countChildren(nodes: FileNode[], dirPath: string): number {
	return nodes.reduce(
		(total, node) => (parentPath(node.path) === dirPath ? total + 1 : total),
		0
	);
}

/** Join a directory and a child name into an absolute path. */
export function joinPath(dir: string, name: string): string {
	return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/** The basename of a path. */
export function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** The path's segments, root-first: "/world/region" → ["world", "region"];
 * "/" → []. Used to render breadcrumbs. */
export function segments(path: string): string[] {
	return path === "/" ? [] : path.split("/").filter(Boolean);
}

/** The directory path made of the first `count` segments of `path`. Used to
 * make each breadcrumb crumb navigable. */
export function pathOfDepth(path: string, count: number): string {
	const parts = segments(path).slice(0, count);
	return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

// Extensions we treat as editable text (open in the Monaco editor). Everything
// else is binary: listed and downloadable, but not opened.
const TEXT_EXTENSIONS = new Set([
	"txt",
	"properties",
	"json",
	"yml",
	"yaml",
	"toml",
	"ini",
	"cfg",
	"conf",
	"config",
	"log",
	"sh",
	"bash",
	"env",
	"md",
	"mcmeta",
	"xml",
	"csv",
]);

function extension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether an extension is one we treat as editable text. Drives whether an
 * upload is read into the editor (and pairs with fileLanguage for highlighting);
 * the single source of truth for "text-like by name". */
export function isTextExtension(name: string): boolean {
	return TEXT_EXTENSIONS.has(extension(name));
}

/** Whether a file opens in the text editor (vs. download-only). Editability is
 * exactly "we have its text": seeded, created, and read-on-upload text files
 * carry `content`; binary and un-read files don't — so the editor can never open
 * a blank buffer over a file whose bytes we never captured. */
export function isTextFile(node: FileNode): boolean {
	return node.kind === "file" && node.content !== undefined;
}

// Best-effort Monaco language id from the extension. Only the shell grammar is
// bundled (see code-editor.tsx), so anything else falls back to plaintext —
// harmless, just unhighlighted.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	sh: "shell",
	bash: "shell",
	env: "shell",
	json: "json",
	yml: "yaml",
	yaml: "yaml",
	toml: "ini",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	properties: "ini",
	xml: "xml",
	md: "markdown",
};

export function fileLanguage(name: string): string {
	return LANGUAGE_BY_EXTENSION[extension(name)] ?? "plaintext";
}

// A conservative allowlist for new names — no path separators or traversal, and
// the reserved "." / ".." are rejected — mirroring the daemon's regex name guard.
// Keeps the stub honest about what the root daemon will accept.
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Validate a new file/folder name. Returns an error string, or null if ok. */
export function validateName(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed === "") {
		return "Enter a name.";
	}
	if (trimmed === "." || trimmed === "..") {
		return "That name is reserved.";
	}
	if (!NAME_PATTERN.test(trimmed)) {
		return "Use letters, numbers, dots, dashes, and underscores only.";
	}
	return null;
}

/** Derive a filename from a download URL's last path segment (query stripped);
 * "download" when there isn't a usable one. */
export function fileNameFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).pop();
		return last ? decodeURIComponent(last) : "download";
	} catch {
		return "download";
	}
}

// Archive extensions we recognize — both for the "Extract" affordance and the
// compress format choices.
const ARCHIVE_EXTENSIONS = new Set([
	"zip",
	"7z",
	"rar",
	"tar",
	"gz",
	"tgz",
	"bz2",
	"xz",
]);

/** Compress formats offered when creating an archive. */
export const ARCHIVE_FORMATS = ["zip", "7z", "rar", "tar"] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

export function isArchive(node: FileNode): boolean {
	return node.kind === "file" && ARCHIVE_EXTENSIONS.has(extension(node.name));
}

/** An archive's name with its extension(s) stripped — names the extract output
 * folder. Handles compound ".tar.gz" / ".tar.xz" / ".tar.bz2". */
export function archiveBaseName(name: string): string {
	const lower = name.toLowerCase();
	if (
		lower.endsWith(".tar.gz") ||
		lower.endsWith(".tar.xz") ||
		lower.endsWith(".tar.bz2")
	) {
		return name.slice(0, -7);
	}
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? name : name.slice(0, dot);
}

/** Total bytes under a path: the file itself, or every descendant file of a
 * directory. Used to estimate a new archive's size. */
export function subtreeBytes(nodes: FileNode[], path: string): number {
	const prefix = `${path}/`;
	return nodes.reduce((total, node) => {
		if (node.kind !== "file") {
			return total;
		}
		return node.path === path || node.path.startsWith(prefix)
			? total + node.size
			: total;
	}, 0);
}

/** A child name not already taken in `dir`, inserting a "-2"-style counter
 * before the extension when needed. `reserved` lets callers also avoid names
 * claimed by in-flight jobs that haven't landed in the tree yet. */
export function uniqueChildName(
	nodes: FileNode[],
	dir: string,
	name: string,
	reserved?: Iterable<string>
): string {
	const taken = new Set(listChildren(nodes, dir).map((child) => child.name));
	if (reserved) {
		for (const claimed of reserved) {
			taken.add(claimed);
		}
	}
	if (!taken.has(name)) {
		return name;
	}
	const dot = name.lastIndexOf(".");
	const base = dot <= 0 ? name : name.slice(0, dot);
	const ext = dot <= 0 ? "" : name.slice(dot);
	let counter = 2;
	while (taken.has(`${base}-${counter}${ext}`)) {
		counter += 1;
	}
	return `${base}-${counter}${ext}`;
}
