// File-manager domain types + pure, client-safe helpers.
//
// A server's files live on its data volume on the node — daemon-derived. The
// daemon lists one directory at a time (rooted at the volume, sandboxed against
// traversal), so the panel browses per-directory rather than holding a whole
// tree. Paths are POSIX, absolute within the volume, and rooted at "/" (there is
// no "above" root). This module is pure: no data, no React.

type FileKind = "file" | "directory";

export type FileEntry = {
	/** Absolute path within the volume, e.g. "/world/level.dat". Root is "/". */
	path: string;
	/** Basename — the last path segment. */
	name: string;
	kind: FileKind;
	/** Size in bytes. Directories report 0. */
	size: number;
	/** ISO 8601 modified time from the daemon (render with formatRelativeTime). */
	modifiedAt: string;
};

/** The parent directory of a path. parentPath("/world/level.dat") → "/world";
 * a root-level path or "/" itself → "/". */
export function parentPath(path: string): string {
	const i = path.lastIndexOf("/");
	return i <= 0 ? "/" : path.slice(0, i);
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

/** The directory path made of the first `count` segments of `path`. Used to make
 * each breadcrumb crumb navigable. */
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

/** Whether a file opens in the text editor (vs. download-only), decided by its
 * extension — the daemon reads its bytes on demand when the editor opens. */
export function isTextFile(entry: FileEntry): boolean {
	return entry.kind === "file" && TEXT_EXTENSIONS.has(extension(entry.name));
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
// the reserved "." / ".." are rejected — mirroring the daemon's name guard.
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

/** An in-flight (or just-finished) URL-download, as the panel tracks it. The
 * daemon pulls the file directly on the box; the panel polls this snapshot. */
export type FileTransfer = {
	id: string;
	name: string;
	state: "running" | "done" | "error" | "cancelled";
	/** Total bytes, or -1 when the upstream didn't advertise a length. */
	total: number;
	done: number;
	error: string | null;
};

/** A transfer's percent complete, or null when the total is unknown (the UI then
 * shows an indeterminate state instead of a misleading bar). */
export function transferProgress(t: FileTransfer): number | null {
	if (t.state === "done") {
		return 100;
	}
	if (t.total <= 0) {
		return null;
	}
	return Math.min(100, Math.round((t.done / t.total) * 100));
}

// Archive formats the panel can ask the daemon to *create* (extraction
// auto-detects a broader set on the box — 7z, rar, gz, bz2, …). The value is
// also the file extension the daemon keys off, so `name.format` is the dest.
export const ARCHIVE_FORMATS = [
	"zip",
	"tar.gz",
	"tar.xz",
	"tar.bz2",
	"tar.zst",
] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

// Suffixes the "Extract here" affordance recognises — the popular archive
// formats the daemon can read (a superset of what it can create).
const ARCHIVE_SUFFIXES = [
	".zip",
	".7z",
	".rar",
	".tar",
	".tar.gz",
	".tgz",
	".tar.xz",
	".txz",
	".tar.bz2",
	".tbz2",
	".tar.zst",
	".tzst",
	".gz",
	".bz2",
	".xz",
	".zst",
];

/** Whether a file looks like an extractable archive (by extension). */
export function isArchive(entry: FileEntry): boolean {
	if (entry.kind !== "file") {
		return false;
	}
	const lower = entry.name.toLowerCase();
	return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** An archive's name with its extension(s) stripped — names the extract output
 * folder. Handles compound ".tar.gz" / ".tar.xz" / ".tar.bz2" / ".tar.zst". */
export function archiveBaseName(name: string): string {
	const lower = name.toLowerCase();
	for (const compound of [".tar.gz", ".tar.xz", ".tar.bz2", ".tar.zst"]) {
		if (lower.endsWith(compound)) {
			return name.slice(0, -compound.length);
		}
	}
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? name : name.slice(0, dot);
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
