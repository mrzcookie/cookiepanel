import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getStorageConfig, isStorageConfigured } from "./client";

/**
 * Object-storage service (server-only). The thin layer the rest of the panel
 * uses to put/delete/address objects in the S3-compatible bucket, plus a guard
 * so we only ever delete objects we own (never an externally-hosted URL such as
 * an OAuth provider's avatar). All operations assume storage is configured;
 * callers gate writes on `isStorageConfigured()`.
 */
export { isStorageConfigured };

/** Upload (or overwrite) an object. */
export async function putObject(input: {
	key: string;
	body: Uint8Array;
	contentType: string;
	cacheControl?: string;
}): Promise<void> {
	const { bucket } = getStorageConfig();
	await getS3Client().send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: input.key,
			Body: input.body,
			ContentType: input.contentType,
			CacheControl: input.cacheControl,
		})
	);
}

/** Delete an object by key. */
export async function deleteObject(key: string): Promise<void> {
	const { bucket } = getStorageConfig();
	await getS3Client().send(
		new DeleteObjectCommand({ Bucket: bucket, Key: key })
	);
}

/**
 * Best-effort delete of an object we own, addressed by its public URL. A no-op
 * for a null / externally-hosted / unconfigured URL (via `ownedKeyFromUrl`), and
 * failures are swallowed — it's only cleanup of a replaced/removed object, never
 * something that should fail the action that triggered it.
 */
export async function deleteOwnedObject(
	url: string | null | undefined,
	prefix: string
): Promise<void> {
	const key = ownedKeyFromUrl(url, prefix);
	if (key) {
		await deleteObject(key).catch(() => {});
	}
}

/** The public URL an object is served from. */
export function publicUrl(key: string): string {
	return `${getStorageConfig().publicUrl}/${key}`;
}

/**
 * Resolve the storage key for a URL we own, or null. Returns the key IF AND
 * ONLY IF `url` lives under our public base AND the key sits under `prefix/`.
 * Lets callers clean up a replaced/removed object without ever touching an
 * externally-hosted URL (e.g. an OAuth avatar). Safe when storage is
 * unconfigured — returns null instead of throwing.
 */
export function ownedKeyFromUrl(
	url: string | null | undefined,
	prefix: string
): string | null {
	if (!url || !isStorageConfigured()) {
		return null;
	}
	const base = `${getStorageConfig().publicUrl}/`;
	if (!url.startsWith(base)) {
		return null;
	}
	const key = url.slice(base.length);
	if (!key.startsWith(`${prefix}/`)) {
		return null;
	}
	return key;
}
