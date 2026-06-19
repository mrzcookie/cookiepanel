import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { recordActivity } from "@/server/activity/record";
import { auth } from "@/server/auth";
import { requireOrg } from "@/server/auth/guards";
import { deleteOwnedObject } from "@/server/storage";
import { validateImageUpload } from "@/server/storage/image-upload";
import { replaceManagedImage } from "@/server/storage/managed-image";
import { organizationRepository } from "./repository";

/**
 * Organization (self-service) server functions for the logo — the typed boundary
 * the settings page calls. Logos are **org-level**, so every function scopes by
 * the caller's verified active org (`requireOrg`) and never trusts a
 * client-supplied id; `replaceManagedImage` mints the storage key server-side,
 * namespaced by `orgId`. (The cross-tenant admin equivalent — setting any org's
 * logo — lives in `server/admin/orgs`.)
 *
 * The `logo` column is owned by Better Auth (a core field on its `organization`
 * table), so the URL is persisted through `auth.api.updateOrganization` rather
 * than a direct DB write — that call also enforces the org's update permission
 * (a plain member is rejected). The only direct DB touch is the read of the
 * current logo (for cleanup), isolated in ./repository. Both return `{ logo }`
 * (the new URL, or null); the UI reads the logo from Better Auth's
 * active-organization query, so a consumer must refetch it after a successful
 * call for the change to show.
 */

/** Storage namespace for org-logo objects. */
const ORG_LOGO_PREFIX = "org-logos";

export const uploadOrgLogo = createServerFn({ method: "POST" })
	.validator(validateImageUpload)
	.handler(async ({ data }) => {
		const { orgId, userId, userName } = await requireOrg();
		const headers = getRequest().headers;

		const { url } = await replaceManagedImage({
			prefix: ORG_LOGO_PREFIX,
			ownerId: orgId,
			file: data.file,
			previousUrl: await organizationRepository.currentLogo(orgId),
			// Persist through Better Auth (it owns `organization.logo`) so its caches
			// stay current; this also enforces the org update permission.
			persist: (logo) =>
				auth.api.updateOrganization({
					body: { data: { logo }, organizationId: orgId },
					headers,
				}),
			errorMessage: "Couldn't update the logo. Please try again.",
		});

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
		const previous = await organizationRepository.currentLogo(orgId);

		// Clear the logo through Better Auth (it owns `organization.logo`).
		// Idempotent — a no-logo call clears nothing, never errors.
		await auth.api.updateOrganization({
			body: { data: { logo: null }, organizationId: orgId },
			headers: getRequest().headers,
		});

		// Best-effort: drop the prior object only when it's one we own.
		await deleteOwnedObject(previous, ORG_LOGO_PREFIX);

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
