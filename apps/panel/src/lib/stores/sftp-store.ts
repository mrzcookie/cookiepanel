import type { SftpSession } from "@/lib/domain/sftp";
import { createStore } from "@/lib/store";

// Ephemeral per-server SFTP sessions. Opening one mints a fresh, single-use
// username + password (the daemon would provision a scoped, time-boxed account
// rooted at the server's volume); closing it revokes them. New session → new
// credentials, every time. A stub for the real per-session SFTP flow; the
// secrets here are throwaway placeholders, generated client-side on demand.

const store = createStore<Record<string, SftpSession>>({});

export function useSftpSession(serverId: string): SftpSession | null {
	return store.use()[serverId] ?? null;
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
	store.set({ ...store.get(), [serverId]: session });
	return session;
}

export function closeSftpSession(serverId: string) {
	const next = { ...store.get() };
	delete next[serverId];
	store.set(next);
}
