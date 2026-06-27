import { randomUUID } from "node:crypto";
import { sniffImage } from "./image-upload";
import {
	deleteObject,
	deleteOwnedObject,
	isStorageConfigured,
	publicUrl,
	putObject,
} from "./index";

/**
 * Upload a server-minted, owner-namespaced image object and return its public
 * URL + storage key. The shared first half of every managed-image flow: re-read
 * the file and magic-byte check it (defense in depth past the validator's MIME
 * check), then put it under a key the client can't influence
 * (`prefix/ownerId/uuid.ext`), immutable-cached. Callers that persist the URL
 * onto an existing row wrap this in `replaceManagedImage`; callers that just
 * need the URL — an egg icon, whose egg may not exist yet — use this directly.
 */
export async function uploadManagedImage(opts: {
	prefix: string;
	ownerId: string;
	file: File;
}): Promise<{ url: string; key: string }> {
	if (!isStorageConfigured()) {
		// Operator/config condition, not user error — keep it presentable.
		throw new Error("Image uploads aren't available right now");
	}
	const { bytes, ext } = await sniffImage(opts.file);
	const key = `${opts.prefix}/${opts.ownerId}/${randomUUID()}.${ext}`;
	await putObject({
		key,
		body: bytes,
		contentType: opts.file.type,
		cacheControl: "public, max-age=31536000, immutable",
	});
	return { url: publicUrl(key), key };
}

/**
 * The shared "replace a managed image" orchestration behind every avatar/logo
 * upload (self-service account + org, and their admin-console counterparts).
 * Sequence, with the tricky failure handling in one place:
 *
 *   sniff (magic-byte check) → put a server-minted, owner-namespaced object →
 *   `persist` the new URL → on persist failure, delete the just-uploaded object
 *   so it isn't stranded → on success, best-effort delete the previous object
 *   (only when it's one we own).
 *
 * `persist` is the only step that varies — it writes the URL wherever that field
 * lives (Better Auth's `user.image` / `organization.logo`, or a direct repo
 * update) — so each call site passes a one-line callback. The key is never
 * client-controlled and is namespaced by `ownerId`, so callers can't collide
 * with or overwrite one another's objects.
 *
 * `previousUrl` is supplied by the caller because each sources it differently
 * (the session for an avatar, a repo read for a logo, an already-loaded admin
 * row), and most already have it in hand.
 *
 * On a `persist` failure: if `errorMessage` is given, the original error is
 * rewrapped in it (so the UI shows something presentable); otherwise it's
 * rethrown as-is (e.g. a generic `Not found` the caller's `persist` threw).
 */
export async function replaceManagedImage(opts: {
	prefix: string;
	ownerId: string;
	file: File;
	previousUrl: string | null | undefined;
	persist: (url: string) => Promise<unknown>;
	errorMessage?: string;
}): Promise<{ url: string }> {
	const { url, key } = await uploadManagedImage({
		prefix: opts.prefix,
		ownerId: opts.ownerId,
		file: opts.file,
	});
	try {
		await opts.persist(url);
	} catch (cause) {
		// The target field never moved — don't strand the object we just uploaded.
		await deleteObject(key).catch(() => {});
		if (opts.errorMessage) {
			throw new Error(opts.errorMessage, { cause });
		}
		throw cause;
	}

	await deleteOwnedObject(opts.previousUrl, opts.prefix);
	return { url };
}
