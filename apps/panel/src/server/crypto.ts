import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { env } from "@/server/env";

/**
 * Server-only symmetric crypto for secrets at rest, built on the validated
 * `ENCRYPTION_KEY` (32 bytes / 64 hex). AES-256-GCM gives confidentiality +
 * integrity, and every ciphertext is bound to a **context string** via the GCM
 * AAD: a sealed blob can't be lifted from one place (a node, a server, an env
 * var) and replayed into another, because the AAD won't match and `unseal`
 * throws. See security.md §2.
 *
 * Never import this into client code — it reads the key from server-only env.
 */

const KEY = Buffer.from(env.ENCRYPTION_KEY, "hex");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Seal `plaintext` under `aad`. Returns base64 of `iv || tag || ciphertext`. The
 * `aad` is authenticated but not encrypted; pass the identical string to `unseal`.
 */
export function seal(plaintext: string, aad: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv("aes-256-gcm", KEY, iv);
	cipher.setAAD(Buffer.from(aad, "utf8"));
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/**
 * Reverse `seal`. Throws on a tampered blob or an `aad` that doesn't match the
 * one it was sealed under (a GCM authentication failure).
 */
export function unseal(blob: string, aad: string): string {
	const buf = Buffer.from(blob, "base64");
	const iv = buf.subarray(0, IV_BYTES);
	const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
	decipher.setAAD(Buffer.from(aad, "utf8"));
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}

/** Lowercase-hex SHA-256 — for indexable, non-reversible lookup hashes. */
export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Constant-time equality of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
