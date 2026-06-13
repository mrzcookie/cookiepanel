import { useSyncExternalStore } from "react";
import type { FileNode } from "@/lib/files";
import { basename, joinPath, parentPath } from "@/lib/files";
import { SERVERS, type ServerRow } from "@/lib/stubs";

// Mutable client-side stub store for the per-server file manager — a stand-in
// for the daemon's sandboxed filesystem. Each server gets a believable tree on
// its data volume; create / rename / delete / edit / upload mutate the browser
// copy only (the seeded snapshot is what SSR and the first client render agree
// on). Replaced wholesale when the real daemon filesystem lands.
//
// A server's tree is a FLAT FileNode[] keyed by absolute path; the directory
// structure is implied by the paths (parentPath / listChildren in lib/files.ts).
// That keeps listing a dir and re-pathing a renamed subtree simple.

const GiB = 1024 ** 3;

// — Seed content ——————————————————————————————————————————————————————————————

const SERVER_PROPERTIES = `#Minecraft server properties
motd=A CookiePanel server
difficulty=normal
gamemode=survival
max-players=20
online-mode=true
pvp=true
view-distance=10
level-name=world
`;

const LATEST_LOG = `[12:04:11] [Server thread/INFO]: Starting minecraft server version 1.21.4
[12:04:11] [Server thread/INFO]: Loading properties
[12:04:12] [Server thread/INFO]: Preparing level "world"
[12:04:18] [Server thread/INFO]: Done (5.913s)! For help, type "help"
[12:09:44] [Server thread/INFO]: Steve joined the game
`;

const VALHEIM_START = `#!/bin/bash
export templdpath=$LD_LIBRARY_PATH
export LD_LIBRARY_PATH=./linux64:$LD_LIBRARY_PATH
export SteamAppId=892970
./valheim_server.x86_64 -name "Midgard" -port 2456 -world "Midgard" -public 1
`;

const GENERIC_SETTINGS = `[server]
name = A CookiePanel server
max_players = 16
port = 27015

[gameplay]
difficulty = normal
pvp = true
`;

// — Tree builders —————————————————————————————————————————————————————————————

function node(
	path: string,
	kind: FileNode["kind"],
	modifiedAt: string,
	extra?: { size?: number; content?: string }
): FileNode {
	return {
		path,
		name: basename(path),
		kind,
		size: extra?.size ?? 0,
		modifiedAt,
		content: extra?.content,
	};
}

function minecraftTree(): FileNode[] {
	return [
		node("/server.properties", "file", "2 hours ago", {
			size: 1124,
			content: SERVER_PROPERTIES,
		}),
		node("/eula.txt", "file", "3 days ago", {
			size: 188,
			content:
				"#By changing the setting below to true you agree to the EULA.\neula=true\n",
		}),
		node("/server.jar", "file", "3 days ago", { size: 49 * 1024 * 1024 }),
		node("/ops.json", "file", "Yesterday", { size: 2, content: "[]\n" }),
		node("/whitelist.json", "file", "3 days ago", { size: 2, content: "[]\n" }),
		node("/world", "directory", "2 hours ago"),
		node("/world/level.dat", "file", "2 hours ago", { size: 8431 }),
		node("/world/session.lock", "file", "2 hours ago", { size: 3 }),
		node("/world/region", "directory", "2 hours ago"),
		node("/world/region/r.0.0.mca", "file", "2 hours ago", {
			size: 8 * 1024 * 1024,
		}),
		node("/world/region/r.0.1.mca", "file", "2 hours ago", {
			size: 6 * 1024 * 1024,
		}),
		node("/plugins", "directory", "3 days ago"),
		node("/plugins/EssentialsX.jar", "file", "3 days ago", {
			size: 2 * 1024 * 1024,
		}),
		node("/logs", "directory", "2 hours ago"),
		node("/logs/latest.log", "file", "5 minutes ago", {
			size: 4096,
			content: LATEST_LOG,
		}),
	];
}

function valheimTree(): FileNode[] {
	return [
		node("/start_server.sh", "file", "1 week ago", {
			size: 412,
			content: VALHEIM_START,
		}),
		node("/valheim_server.x86_64", "file", "1 week ago", {
			size: 28 * 1024 * 1024,
		}),
		node("/worlds_local", "directory", "4 hours ago"),
		node("/worlds_local/Midgard.db", "file", "4 hours ago", {
			size: 12 * 1024 * 1024,
		}),
		node("/worlds_local/Midgard.fwl", "file", "5 days ago", { size: 168 }),
		node("/server_logs.txt", "file", "4 hours ago", {
			size: 9216,
			content:
				"Game server connected\nWorld 'Midgard' loaded\nGot connection SteamID 76561198000000000\n",
		}),
	];
}

function genericTree(): FileNode[] {
	return [
		node("/start.sh", "file", "2 days ago", {
			size: 96,
			content: "#!/bin/bash\n./server -config config/settings.ini\n",
		}),
		node("/README.txt", "file", "2 days ago", {
			size: 240,
			content: "Server files live here. Edit config/settings.ini to tune it.\n",
		}),
		node("/config", "directory", "1 day ago"),
		node("/config/settings.ini", "file", "1 day ago", {
			size: 320,
			content: GENERIC_SETTINGS,
		}),
		node("/data", "directory", "6 hours ago"),
		node("/data/save.dat", "file", "6 hours ago", {
			size: Math.round(0.5 * GiB),
		}),
		node("/logs", "directory", "1 hour ago"),
		node("/logs/server.log", "file", "1 hour ago", {
			size: 5120,
			content: "Server started\nListening on 0.0.0.0\n",
		}),
	];
}

function buildTree(server: ServerRow): FileNode[] {
	if (server.templateName.includes("Minecraft")) {
		return minecraftTree();
	}
	if (server.templateName.includes("Valheim")) {
		return valheimTree();
	}
	return genericTree();
}

function seedTrees(): Record<string, FileNode[]> {
	const trees: Record<string, FileNode[]> = {};
	for (const server of SERVERS) {
		trees[server.id] = buildTree(server);
	}
	return trees;
}

// — Store ——————————————————————————————————————————————————————————————————————

let trees: Record<string, FileNode[]> = seedTrees();
const EMPTY: FileNode[] = [];
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return trees;
}

/** A server's flat file list (stable reference until it mutates). Callers derive
 * the current directory's children with listChildren() from lib/files. */
export function useServerFiles(serverId: string): FileNode[] {
	const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return all[serverId] ?? EMPTY;
}

function setTree(serverId: string, next: FileNode[]) {
	trees = { ...trees, [serverId]: next };
	emit();
}

// — Mutations —————————————————————————————————————————————————————————————————

function addNode(serverId: string, entry: FileNode) {
	const current = trees[serverId] ?? EMPTY;
	setTree(serverId, [...current, entry]);
}

/** Add several nodes at once (e.g. the folder + files an extract produces). */
export function addNodes(serverId: string, entries: FileNode[]) {
	const current = trees[serverId] ?? EMPTY;
	setTree(serverId, [...current, ...entries]);
}

/** Delete several paths and, for directories, their subtrees, in one update. */
export function deleteNodes(serverId: string, paths: string[]) {
	const current = trees[serverId] ?? EMPTY;
	const targets = new Set(paths);
	const prefixes = paths.map((path) => `${path}/`);
	setTree(
		serverId,
		current.filter(
			(entry) =>
				!targets.has(entry.path) &&
				!prefixes.some((prefix) => entry.path.startsWith(prefix))
		)
	);
}

export function createDirectory(serverId: string, dir: string, name: string) {
	addNode(serverId, {
		path: joinPath(dir, name),
		name,
		kind: "directory",
		size: 0,
		modifiedAt: "Just now",
	});
}

export function createFile(serverId: string, dir: string, name: string) {
	addNode(serverId, {
		path: joinPath(dir, name),
		name,
		kind: "file",
		size: 0,
		modifiedAt: "Just now",
		content: "",
	});
}

/** Add a browser-uploaded file (real File: name + byte size, text content when
 * we could read it). */
export function uploadFile(
	serverId: string,
	dir: string,
	name: string,
	size: number,
	content?: string
) {
	addNode(serverId, {
		path: joinPath(dir, name),
		name,
		kind: "file",
		size,
		modifiedAt: "Just now",
		content,
	});
}

export function renameNode(serverId: string, path: string, newName: string) {
	const current = trees[serverId] ?? EMPTY;
	const newPath = joinPath(parentPath(path), newName);
	const subtreePrefix = `${path}/`;
	setTree(
		serverId,
		current.map((entry) => {
			if (entry.path === path) {
				return {
					...entry,
					path: newPath,
					name: newName,
					modifiedAt: "Just now",
				};
			}
			// Re-path descendants of a renamed directory.
			if (entry.path.startsWith(subtreePrefix)) {
				return { ...entry, path: newPath + entry.path.slice(path.length) };
			}
			return entry;
		})
	);
}

/** Delete a node and, for a directory, everything under it. */
export function deleteNode(serverId: string, path: string) {
	const current = trees[serverId] ?? EMPTY;
	const subtreePrefix = `${path}/`;
	setTree(
		serverId,
		current.filter(
			(entry) => entry.path !== path && !entry.path.startsWith(subtreePrefix)
		)
	);
}

export function writeFile(serverId: string, path: string, content: string) {
	const current = trees[serverId] ?? EMPTY;
	setTree(
		serverId,
		current.map((entry) =>
			entry.path === path
				? {
						...entry,
						content,
						size: new Blob([content]).size,
						modifiedAt: "Just now",
					}
				: entry
		)
	);
}
