import { useSyncExternalStore } from "react";

// Ephemeral per-server SFTP sessions. Opening one mints a fresh, single-use
// username + password (the daemon would provision a scoped, time-boxed account
// rooted at the server's volume); closing it revokes them. New session → new
// credentials, every time. A stub for the real per-session SFTP flow; the
// secrets here are throwaway placeholders, generated client-side on demand.

export type SftpSession = {
	id: string;
	serverId: string;
	host: string;
	port: number;
	username: string;
	password: string;
};

let sessions: Record<string, SftpSession> = {};
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
	return sessions;
}

export function useSftpSession(serverId: string): SftpSession | null {
	const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return all[serverId] ?? null;
}

// Unambiguous alphabet (no 0/o/1/l/i) so a copied credential is easy to retype.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function token(length: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	let out = "";
	for (const byte of bytes) {
		out += ALPHABET[byte % ALPHABET.length];
	}
	return out;
}

export function openSftpSession(serverId: string, host: string): SftpSession {
	const session: SftpSession = {
		id: crypto.randomUUID(),
		serverId,
		host,
		port: 2022,
		username: `srv-${token(10)}`,
		password: token(20),
	};
	sessions = { ...sessions, [serverId]: session };
	emit();
	return session;
}

export function closeSftpSession(serverId: string) {
	const next = { ...sessions };
	delete next[serverId];
	sessions = next;
	emit();
}
