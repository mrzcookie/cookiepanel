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
import { sniffImage, validateImageUpload } from "@/server/storage/image-upload";

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

export const uploadAvatar = createServerFn({ method: "POST" })
	.validator(validateImageUpload)
	.handler(async ({ data }) => {
		const { file } = data;
		const session = await requireSession();

		if (!isStorageConfigured()) {
			// Operator/config condition, not user error — keep it presentable.
			throw new Error("Image uploads aren't available right now");
		}

		// Re-read + magic-byte check (defense in depth past the validator's MIME
		// check); yields the bytes and a safe extension.
		const { bytes, ext } = await sniffImage(file);
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
