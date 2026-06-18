import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
	AdminOrgMember,
	AdminOrgRow,
	MemberRole,
} from "@/lib/domain/admin";
import { recordActivity } from "@/server/activity/record";
import { requireAdmin } from "@/server/auth/guards";
import {
	deleteObject,
	isStorageConfigured,
	ownedKeyFromUrl,
	publicUrl,
	putObject,
} from "@/server/storage";
import { sniffImage, validateImageUpload } from "@/server/storage/image-upload";
import {
	type OrgMemberRecord,
	type OrgRecord,
	orgsRepository,
} from "./repository";

/**
 * Platform orgs service + server functions — the typed boundary the /admin orgs
 * panel calls. Each is a thin `auth + validate + delegate` shim: gate on
 * `requireAdmin` (the global capability, NOT org membership — see guards.ts),
 * validate input (Zod), and delegate.
 *
 * Reads + writes go through ./repository, which is **deliberately not org-scoped**
 * (the admin surface spans every org). Writes are direct DB updates because Better
 * Auth's organization plugin offers no cross-org admin endpoint — see the note in
 * ./repository. Sensitive actions are audited best-effort to the activity log.
 */

/** Storage namespace for org-logo objects (shared with the settings-page logo). */
const ORG_LOGO_PREFIX = "org-logos";

/** Owners first, then admins, then plain members. */
const ROLE_RANK: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };

/** Map an org row + its derived counts to the client-safe row. */
function toAdminOrgRow(
	org: OrgRecord,
	memberCount: number,
	nodeCount: number
): AdminOrgRow {
	const createdAt =
		org.createdAt instanceof Date ? org.createdAt : new Date(org.createdAt);
	return {
		id: org.id,
		name: org.name,
		slug: org.slug,
		logo: org.logo ?? null,
		createdAt: createdAt.toISOString(),
		memberCount,
		nodeCount,
	};
}

/** Map a joined member row to the client-safe member view. */
function toAdminOrgMember(record: OrgMemberRecord): AdminOrgMember {
	return {
		id: record.id,
		userId: record.userId,
		name: record.name,
		email: record.email,
		image: record.image ?? null,
		role: record.role as MemberRole,
		joinedAt: record.joinedAt.toISOString(),
	};
}

/** Load one org (with its counts) by id, or throw a generic not-found if gone. */
async function loadOrgRow(orgId: string): Promise<AdminOrgRow> {
	const org = await orgsRepository.findById(orgId);
	if (!org) {
		throw new Error("Not found");
	}
	const [members, nodes] = await Promise.all([
		orgsRepository.memberCounts([orgId]),
		orgsRepository.nodeCounts([orgId]),
	]);
	return toAdminOrgRow(org, members.get(orgId) ?? 0, nodes.get(orgId) ?? 0);
}

const orgIdInput = z.object({ orgId: z.string().min(1) });

export const listAdminOrgs = createServerFn({ method: "GET" }).handler(
	async (): Promise<AdminOrgRow[]> => {
		await requireAdmin();
		const orgs = await orgsRepository.list();
		const ids = orgs.map((org) => org.id);
		const [members, nodes] = await Promise.all([
			orgsRepository.memberCounts(ids),
			orgsRepository.nodeCounts(ids),
		]);
		return orgs.map((org) =>
			toAdminOrgRow(org, members.get(org.id) ?? 0, nodes.get(org.id) ?? 0)
		);
	}
);

export const getAdminOrgMembers = createServerFn({ method: "GET" })
	.validator(orgIdInput)
	.handler(async ({ data }): Promise<AdminOrgMember[]> => {
		await requireAdmin();
		const rows = await orgsRepository.membersForOrg(data.orgId);
		return rows
			.map(toAdminOrgMember)
			.sort(
				(a, b) =>
					ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name)
			);
	});

const updateInput = z.object({
	orgId: z.string().min(1),
	name: z.string().trim().min(1).max(100),
});

export const updateAdminOrg = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();

		const updated = await orgsRepository.updateName(data.orgId, data.name);
		if (!updated) {
			throw new Error("Not found");
		}

		await recordActivity({
			category: "organization",
			action: "organization.updated",
			organizationId: updated.id,
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "organization",
			targetId: updated.id,
			targetLabel: updated.name,
		});
		return loadOrgRow(data.orgId);
	});

/**
 * Set an org's logo from the admin console. Same shape as the settings-page
 * `uploadOrgLogo` (S3 put → persist the URL → drop the old object), but the URL is
 * written directly (the admin isn't a member, so Better Auth's
 * `updateOrganization` would reject it) and the key is namespaced by `orgId`.
 * Expects a multipart body carrying `file` + `orgId`.
 */
function validateOrgLogoUpload(input: unknown): { file: File; orgId: string } {
	const { file } = validateImageUpload(input);
	const orgId = (input as FormData).get("orgId");
	if (typeof orgId !== "string" || orgId.length === 0) {
		throw new Error("No organization provided");
	}
	return { file, orgId };
}

export const uploadAdminOrgLogo = createServerFn({ method: "POST" })
	.validator(validateOrgLogoUpload)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();

		if (!isStorageConfigured()) {
			// Operator/config condition, not user error — keep it presentable.
			throw new Error("Image uploads aren't available right now");
		}

		// Load first: a generic not-found on a bad id, plus the prior logo to clean up.
		const before = await loadOrgRow(data.orgId);

		// Re-read + magic-byte check past the validator's MIME check; yields the
		// bytes and a safe extension. The key is server-minted and namespaced by the
		// org, so it can't collide with another org's objects.
		const { bytes, ext } = await sniffImage(data.file);
		const key = `${ORG_LOGO_PREFIX}/${data.orgId}/${randomUUID()}.${ext}`;

		await putObject({
			key,
			body: bytes,
			contentType: data.file.type,
			cacheControl: "public, max-age=31536000, immutable",
		});

		const url = publicUrl(key);
		const updated = await orgsRepository.updateLogo(data.orgId, url);
		if (!updated) {
			// The org vanished between the load and the write — don't strand the object.
			await deleteObject(key).catch(() => {});
			throw new Error("Not found");
		}

		// Best-effort: drop the prior logo, but only when it's one we own.
		const prevKey = ownedKeyFromUrl(before.logo, ORG_LOGO_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		await recordActivity({
			category: "organization",
			action: "organization.logo_updated",
			organizationId: updated.id,
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "organization",
			targetId: updated.id,
			targetLabel: updated.name,
		});
		return loadOrgRow(data.orgId);
	});

export const removeAdminOrgLogo = createServerFn({ method: "POST" })
	.validator(orgIdInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();
		const before = await loadOrgRow(data.orgId);

		const updated = await orgsRepository.updateLogo(data.orgId, null);
		if (!updated) {
			throw new Error("Not found");
		}

		const prevKey = ownedKeyFromUrl(before.logo, ORG_LOGO_PREFIX);
		if (prevKey) {
			await deleteObject(prevKey).catch(() => {});
		}

		// Only audit a real removal — no spurious entry when there was no logo.
		if (before.logo) {
			await recordActivity({
				category: "organization",
				action: "organization.logo_removed",
				organizationId: updated.id,
				userId: admin.userId,
				actorName: admin.userName,
				targetType: "organization",
				targetId: updated.id,
				targetLabel: updated.name,
			});
		}
		return loadOrgRow(data.orgId);
	});

export const deleteAdminOrg = createServerFn({ method: "POST" })
	.validator(orgIdInput)
	.handler(async ({ data }) => {
		const admin = await requireAdmin();

		// Capture the logo before the row (and its objects' provenance) is gone.
		const logo = await orgsRepository.currentLogo(data.orgId);
		const removed = await orgsRepository.remove(data.orgId);
		if (!removed) {
			throw new Error("Not found");
		}

		// Best-effort: drop the org's logo object, when it's one we own.
		const logoKey = ownedKeyFromUrl(logo, ORG_LOGO_PREFIX);
		if (logoKey) {
			await deleteObject(logoKey).catch(() => {});
		}

		// `organizationId` is intentionally null: the org's own activity rows
		// cascade away with it, so an entry pinned to the deleted org would be
		// erased immediately (and the FK insert would fail). This is a
		// platform-level action — the org rides the target fields instead.
		await recordActivity({
			category: "organization",
			action: "organization.deleted",
			userId: admin.userId,
			actorName: admin.userName,
			targetType: "organization",
			targetId: removed.id,
			targetLabel: removed.name,
		});
		return { id: removed.id };
	});
