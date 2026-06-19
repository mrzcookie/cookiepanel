import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requireSession } from "@/server/auth/guards";
import { deleteOwnedObject } from "@/server/storage";
import { validateImageUpload } from "@/server/storage/image-upload";
import { replaceManagedImage } from "@/server/storage/managed-image";

/**
 * User (self-service) server functions for the avatar — the typed boundary the
 * account page calls. Avatars are **user-level** (they belong to the User,
 * not an organization), so every function scopes strictly by the authenticated
 * session `userId` (`requireSession`) and never trusts a client-supplied id;
 * `replaceManagedImage` mints the storage key server-side, namespaced by `userId`.
 * (The cross-tenant admin equivalent — setting any user's avatar — lives in
 * `server/admin/users`.)
 *
 * The `image` column is owned by Better Auth (a core field on its generated
 * `user` table), so the avatar URL is persisted through `auth.api.updateUser`
 * rather than a direct DB write. That keeps Better Auth's session/cookie cache
 * consistent — the `tanstackStartCookies` plugin forwards the refreshed cookie
 * even for this server-side call — and avoids reaching behind the auth layer.
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
		const session = await requireSession();
		const headers = getRequest().headers;

		const { url } = await replaceManagedImage({
			prefix: AVATAR_PREFIX,
			ownerId: session.user.id,
			file: data.file,
			previousUrl: session.user.image,
			// Persist through Better Auth (it owns `user.image`) so the session +
			// cookie cache stay current.
			persist: (image) => auth.api.updateUser({ body: { image }, headers }),
			errorMessage: "Couldn't update your avatar. Please try again.",
		});

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
		await deleteOwnedObject(previous, AVATAR_PREFIX);

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
