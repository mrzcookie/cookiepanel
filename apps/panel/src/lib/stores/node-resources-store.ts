import { createStore } from "@/lib/store";
import { DRIVES } from "@/lib/stubs";

// Mutable client-side stub store for a node's drives (the Storage tab). Port
// allocations + the firewall moved to the real data layer (allocation-queries /
// networking-queries); drives stay stubbed until the disk subsystem lands.

const drives = createStore(DRIVES);

export function useDrives(nodeId: string) {
	return drives.use().filter((row) => row.nodeId === nodeId);
}

export function formatDrive(
	id: string,
	filesystem: string,
	mountpoint: string
) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id ? { ...row, filesystem, mountpoint, usedBytes: 0 } : row
			)
	);
}

export function mountDrive(id: string, mountpoint: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id
					? { ...row, mountpoint, usedBytes: row.usedBytes ?? 0 }
					: row
			)
	);
}

export function unmountDrive(id: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.id === id
					? { ...row, isDataTarget: false, mountpoint: null, usedBytes: null }
					: row
			)
	);
}

export function setDataTarget(nodeId: string, id: string) {
	drives.set(
		drives
			.get()
			.map((row) =>
				row.nodeId === nodeId ? { ...row, isDataTarget: row.id === id } : row
			)
	);
}
