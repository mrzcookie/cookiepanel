import { createHmac } from "node:crypto";

/**
 * Minimal HS256 JWT mint for the browser console. No JWT library: the only
 * audience is one daemon that shares a per-node symmetric signing secret with
 * the panel, so there's no need for key rotation / JWKS / RS*. Server-only.
 */

function base64url(input: Buffer | string): string {
	const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
	return buf.toString("base64url");
}

export type BrowserClaims = {
	serverId: string;
	nodeId: string;
	permissions: string[];
};

/** Sign a JWT good for `ttlSeconds` against the given HS256 secret. */
export function signBrowserToken(
	secret: string,
	claims: BrowserClaims,
	ttlSeconds = 60
): string {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "HS256", typ: "JWT" };
	const payload = { ...claims, iat: now, exp: now + ttlSeconds };
	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
		JSON.stringify(payload)
	)}`;
	const sig = createHmac("sha256", secret).update(signingInput).digest();
	return `${signingInput}.${base64url(sig)}`;
}
