import { unseal } from "@/server/crypto";

// Server-only helpers for a server's sealed secret variables. The AAD binds each
// sealed blob to its org + server + env-var, so a blob can't be lifted to another
// context (the GCM auth fails on a wrong AAD). This is the single source of truth
// for that AAD — both the create/update sealing path and any reader (e.g. the
// Redis browser recovering REDIS_PASSWORD) go through it.

/** The AAD a server secret variable is sealed under. Must stay stable. */
export function serverSecretAad(
	orgId: string,
	serverId: string,
	envVar: string
): string {
	return `server-var:${orgId}:${serverId}:${envVar}`;
}

/**
 * Unseal one of a server's secret variables, or "" when it isn't set. Throws if a
 * present blob fails to authenticate (tampering / wrong context).
 */
export function unsealServerSecret(
	orgId: string,
	serverId: string,
	envVar: string,
	sealed: Record<string, string>
): string {
	const blob = sealed[envVar];
	return blob ? unseal(blob, serverSecretAad(orgId, serverId, envVar)) : "";
}
