import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requireSession } from "@/server/auth/guards";
import {
	deleteObject,
	isStorageConfigured,
	ownedKeyFromUrl,
	publicUrl,
	putObject,
} from "@/server/storage";

/**
 * User server functions for the avatar — the typed boundary the account page
 * calls. Avatars are **user-level** (they belong to the User, not an
 * organization), so every function scopes strictly by the authenticated session
 * `userId` (`requireSession`) and never trusts a client-supplied id. The storage
 * key is minted server-side and namespaced by `userId`, so users can't collide
 * with or overwrite one another.
 *
 * The `image` column is owned by Better Auth (a core field on its generated
 * `user` table), so the avatar URL is persisted through `auth.api.updateUser`
 * rather than a direct DB write. That keeps Better Auth's session/cookie cache
 * consistent — the `tanstackStartCookies` plugin forwards the refreshed cookie
 * even for this server-side call — and avoids reaching behind the auth layer.
 * These functions only add the S3 upload + old-object cleanup around that call.
 *
 * Both return `{ image }` (the new URL, or null). The panel reads the avatar from
 * the Better Auth session (`user.image`), not a query cache, so a consumer must
 * refetch the session after a successful call (e.g. `authClient.useSession()`'s
 * `refetch`) for the change to show in the UI.
 */

/** Storage namespace for avatar objects. */
const AVATAR_PREFIX = "avatars";

/** 2 MB — matches the client cap in `image-upload-field.tsx`. */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Allowed image MIME types → file extension. Must match `IMAGE_UPLOAD_ACCEPT`
 * in `image-upload-field.tsx` (PNG, JPG, WebP — no SVG).
 */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};

/**
 * Defense in depth: verify the file's magic bytes match the claimed MIME type,
 * so a client can't smuggle arbitrary content past the `type` check alone.
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`
 * - JPEG: `FF D8 FF`
 * - WebP: bytes 0..3 are ASCII "RIFF" and bytes 8..11 are ASCII "WEBP"
 */
function sniffMatchesMime(bytes: Uint8Array, mime: string): boolean {
	switch (mime) {
		case "image/png":
			return (
				bytes.length >= 8 &&
				bytes[0] === 0x89 &&
				bytes[1] === 0x50 &&
				bytes[2] === 0x4e &&
				bytes[3] === 0x47 &&
				bytes[4] === 0x0d &&
				bytes[5] === 0x0a &&
				bytes[6] === 0x1a &&
				bytes[7] === 0x0a
			);
		case "image/jpeg":
			return (
				bytes.length >= 3 &&
				bytes[0] === 0xff &&
				bytes[1] === 0xd8 &&
				bytes[2] === 0xff
			);
		case "image/webp":
			return (
				bytes.length >= 12 &&
				// "RIFF"
				bytes[0] === 0x52 &&
				bytes[1] === 0x49 &&
				bytes[2] === 0x46 &&
				bytes[3] === 0x46 &&
				// "WEBP"
				bytes[8] === 0x57 &&
				bytes[9] === 0x45 &&
				bytes[10] === 0x42 &&
				bytes[11] === 0x50
			);
		default:
			return false;
	}
}

/**
 * Validate the multipart upload before it reaches the handler. `accept` and the
 * client cap are only hints; everything is re-checked here authoritatively.
 */
function validateUpload(input: unknown): { file: File } {
	if (!(input instanceof FormData)) {
		throw new Error("Expected a multipart form upload");
	}
	const file = input.get("file");
	if (!(file instanceof File)) {
		throw new Error("No file provided");
	}
	if (!(file.type in ALLOWED_IMAGE_TYPES)) {
		throw new Error("Use a PNG, JPG, or WebP image");
	}
	if (file.size <= 0) {
		throw new Error("That file is empty");
	}
	if (file.size > MAX_AVATAR_BYTES) {
		throw new Error("That image is over 2 MB");
	}
	return { file };
}

export const uploadAvatar = createServerFn({ method: "POST" })
	.validator(validateUpload)
	.handler(async ({ data }) => {
		const { file } = data;
		const session = await requireSession();

		if (!isStorageConfigured()) {
			// Operator/config condition, not user error — keep it presentable.
			throw new Error("Image uploads aren't available right now");
		}

		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!sniffMatchesMime(bytes, file.type)) {
			throw new Error("That file doesn't look like a PNG, JPG, or WebP image");
		}

		const ext = ALLOWED_IMAGE_TYPES[file.type];
		if (!ext) {
			// Unreachable given the validator's allowlist + the sniff above, but
			// narrow explicitly so the type system guarantees a well-formed key.
			throw new Error("That file doesn't look like a PNG, JPG, or WebP image");
		}
		// The key is never client-controlled and is namespaced by `userId`, so
		// users can't collide with or overwrite each other's objects.
		const key = `${AVATAR_PREFIX}/${session.user.id}/${randomUUID()}.${ext}`;

		await putObject({
			key,
			body: bytes,
			contentType: file.type,
			cacheControl: "public, max-age=31536000, immutable",
		});

		const url = publicUrl(key);
		try {
			// Persist through Better Auth (it owns `user.image`) so the session +
			// cookie cache stay current.
			await auth.api.updateUser({
				body: { image: url },
				headers: getRequest().headers,
			});
		} catch (error) {
			// The profile never moved — don't strand the object we just uploaded
			// with no row referencing it (and no way to reclaim it).
			await deleteObject(key).catch(() => {});
			throw new Error("Couldn't update your avatar. Please try again.", {
				cause: error,
			});
		}

		// Best-effort: clean up the prior avatar, but only when it's one we own.
		const prevKey = ownedKeyFromUrl(session.user.image, AVATAR_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		await recordActivity({
			category: "account",
			action: "account.avatar_updated",
			userId: session.user.id,
			actorName: session.user.name,
		});

		return { image: url };
	});

export const removeAvatar = createServerFn({ method: "POST" }).handler(
	async () => {
		const session = await requireSession();
		const previous = session.user.image;

		// Clear the avatar through Better Auth (it owns `user.image`); `image: null`
		// removes it. Idempotent — a no-avatar call clears nothing, never errors.
		await auth.api.updateUser({
			body: { image: null },
			headers: getRequest().headers,
		});

		// Best-effort: drop the prior object only when it's one we own.
		// `ownedKeyFromUrl` already yields null when storage is unconfigured.
		const prevKey = ownedKeyFromUrl(previous, AVATAR_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		// Only audit a real removal — no spurious entry when there was no avatar.
		if (previous) {
			await recordActivity({
				category: "account",
				action: "account.avatar_removed",
				userId: session.user.id,
				actorName: session.user.name,
			});
		}

		return { image: null };
	}
);
