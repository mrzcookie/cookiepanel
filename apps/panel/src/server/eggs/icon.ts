import { randomUUID } from "node:crypto";
import {
	copyObject,
	deleteOwnedObject,
	ownedKeyFromUrl,
	publicUrl,
} from "@/server/storage";

/**
 * Egg-icon object storage — the egg-side glue over the shared S3 helpers, kept
 * out of the service so the business logic stays about eggs, not buckets. Egg
 * icons live alongside avatars and org logos: server-minted, owner-namespaced
 * objects under one prefix (`egg-icons/<orgId|official>/<uuid>.<ext>`), the URL
 * stored on the egg row and served straight from the public base.
 */

/** Storage namespace for egg-icon objects (mirrors avatars / org-logos). */
export const EGG_ICON_PREFIX = "egg-icons";

/**
 * Narrow an egg's stored icon URL to one we actually serve — a real object under
 * our storage base *and* the egg-icon prefix — or null. The egg-icon twin of the
 * eggs-over-images blanking in `toEgg`: it drops `data:` URLs (including the
 * legacy inline icons from before icons moved to S3, so a 500 KB blob reads back
 * as "no icon" rather than a payload) and any externally-hosted URL a crafted
 * request might smuggle in. With storage unconfigured everything narrows to null
 * — there are no owned objects to serve anyway.
 */
export function ownedIconUrl(url: string | null): string | null {
	return ownedKeyFromUrl(url, EGG_ICON_PREFIX) ? url : null;
}

/**
 * Give a fork its *own* copy of the source egg's icon, namespaced under
 * `ownerId`, so the two eggs never share one object (which would let deleting or
 * replacing either one strand or break the other). Returns the new owned URL, or
 * null when the source has no owned icon — or when the copy fails: this never
 * throws, so a fork can't fail over its icon (it just starts iconless, and the
 * author can re-upload).
 */
export async function forkIconUrl(
	sourceUrl: string | null,
	ownerId: string
): Promise<string | null> {
	const sourceKey = ownedKeyFromUrl(sourceUrl, EGG_ICON_PREFIX);
	if (!sourceKey) {
		return null;
	}
	try {
		// Carry the source's extension (keys are `…/<uuid>.<ext>`); tolerate none.
		const dot = sourceKey.lastIndexOf(".");
		const ext = dot > sourceKey.lastIndexOf("/") ? sourceKey.slice(dot) : "";
		const destKey = `${EGG_ICON_PREFIX}/${ownerId}/${randomUUID()}${ext}`;
		await copyObject({ sourceKey, destKey });
		return publicUrl(destKey);
	} catch {
		return null;
	}
}

/**
 * Best-effort delete of an egg's *owned* icon object — for when an icon is
 * replaced or its egg is removed. A no-op for null / `data:` / externally-hosted
 * URLs (via `ownedKeyFromUrl`), and failures are swallowed: it's only cleanup of
 * a replaced/removed object, never something that should fail the action that
 * triggered it.
 */
export function deleteEggIcon(url: string | null | undefined): Promise<void> {
	return deleteOwnedObject(url, EGG_ICON_PREFIX);
}
