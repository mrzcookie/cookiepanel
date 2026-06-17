import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requireOrg } from "@/server/auth/guards";
import { db } from "@/server/db";
import { organization } from "@/server/db/schema/auth";
import {
	deleteObject,
	isStorageConfigured,
	ownedKeyFromUrl,
	publicUrl,
	putObject,
} from "@/server/storage";
import { sniffImage, validateImageUpload } from "@/server/storage/image-upload";

/**
 * Organization server functions for the logo — the typed boundary the settings
 * page calls. Logos are **org-level**, so every function scopes by the caller's
 * verified active org (`requireOrg`) and never trusts a client-supplied id; the
 * storage key is minted server-side and namespaced by `orgId`, so orgs can't
 * collide with or overwrite one another.
 *
 * The `logo` column is owned by Better Auth (a core field on its `organization`
 * table), so the URL is persisted through `auth.api.updateOrganization` rather
 * than a direct DB write — that call also enforces the org's update permission
 * (a plain member is rejected). These functions add the S3 upload + old-object
 * cleanup around it. Both return `{ logo }` (the new URL, or null); the UI reads
 * the logo from Better Auth's active-organization query, so a consumer must
 * refetch it after a successful call for the change to show.
 */

/** Storage namespace for org-logo objects. */
const ORG_LOGO_PREFIX = "org-logos";

/** The active org's current logo, for cleanup of the object we're replacing. */
async function currentLogo(orgId: string): Promise<string | null> {
	const [row] = await db
		.select({ logo: organization.logo })
		.from(organization)
		.where(eq(organization.id, orgId))
		.limit(1);
	return row?.logo ?? null;
}

export const uploadOrgLogo = createServerFn({ method: "POST" })
	.validator(validateImageUpload)
	.handler(async ({ data }) => {
		const { file } = data;
		const { orgId, userId, userName } = await requireOrg();

		if (!isStorageConfigured()) {
			// Operator/config condition, not user error — keep it presentable.
			throw new Error("Image uploads aren't available right now");
		}

		// Re-read + magic-byte check (defense in depth past the validator's MIME
		// check); yields the bytes and a safe extension.
		const { bytes, ext } = await sniffImage(file);
		// The key is never client-controlled and is namespaced by `orgId`, so orgs
		// can't collide with or overwrite each other's objects.
		const key = `${ORG_LOGO_PREFIX}/${orgId}/${randomUUID()}.${ext}`;

		await putObject({
			key,
			body: bytes,
			contentType: file.type,
			cacheControl: "public, max-age=31536000, immutable",
		});

		const url = publicUrl(key);
		const previous = await currentLogo(orgId);
		try {
			// Persist through Better Auth (it owns `organization.logo`) so its caches
			// stay current; this also enforces the org update permission.
			await auth.api.updateOrganization({
				body: { data: { logo: url }, organizationId: orgId },
				headers: getRequest().headers,
			});
		} catch (error) {
			// The org never moved — don't strand the object we just uploaded.
			await deleteObject(key).catch(() => {});
			throw new Error("Couldn't update the logo. Please try again.", {
				cause: error,
			});
		}

		// Best-effort: clean up the prior logo, but only when it's one we own.
		const prevKey = ownedKeyFromUrl(previous, ORG_LOGO_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		await recordActivity({
			category: "organization",
			action: "organization.logo_updated",
			organizationId: orgId,
			userId,
			actorName: userName,
			targetType: "organization",
			targetId: orgId,
		});

		return { logo: url };
	});

export const removeOrgLogo = createServerFn({ method: "POST" }).handler(
	async () => {
		const { orgId, userId, userName } = await requireOrg();
		const previous = await currentLogo(orgId);

		// Clear the logo through Better Auth (it owns `organization.logo`).
		// Idempotent — a no-logo call clears nothing, never errors.
		await auth.api.updateOrganization({
			body: { data: { logo: null }, organizationId: orgId },
			headers: getRequest().headers,
		});

		// Best-effort: drop the prior object only when it's one we own.
		const prevKey = ownedKeyFromUrl(previous, ORG_LOGO_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		// Only audit a real removal — no spurious entry when there was no logo.
		if (previous) {
			await recordActivity({
				category: "organization",
				action: "organization.logo_removed",
				organizationId: orgId,
				userId,
				actorName: userName,
				targetType: "organization",
				targetId: orgId,
			});
		}

		return { logo: null };
	}
);
