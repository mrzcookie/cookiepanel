import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/guards";
import type { OwnerScope } from "@/server/eggs/repository";
import type { Actor } from "@/server/eggs/service";
import * as service from "@/server/eggs/service";
import { eggInputSchema } from "@/server/eggs/validation";

/**
 * The official egg library — the platform-owned (null-org) eggs every
 * organization can deploy from, curated under /admin/eggs. Same shared
 * service as the org surface, but gated on `requirePlatformAdmin` (the global
 * capability, NOT org membership — see guards.ts) and scoped to the official
 * library. Audit rows carry a null organizationId (a platform-level action),
 * mirroring the admin org-delete convention.
 *
 * There is no fork here: admins author official eggs directly; "Customize"
 * is an org-side action that copies an official egg *into* an org.
 */

const SCOPE: OwnerScope = { kind: "official" };

async function adminContext(): Promise<{ scope: OwnerScope; actor: Actor }> {
	const { userId, userName } = await requirePlatformAdmin();
	return { scope: SCOPE, actor: { userId, userName, orgId: null } };
}

const idInput = z.object({ id: z.uuid() });
const updateInput = z.object({ id: z.uuid(), input: eggInputSchema });
const importJsonInput = z.object({ json: z.string().min(1).max(512_000) });
const importUrlInput = z.object({ url: z.string().trim().min(1).max(2000) });

export const listAdminEggs = createServerFn({ method: "GET" }).handler(
	async () => {
		const { scope } = await adminContext();
		return service.listEggs(scope);
	}
);

export const getAdminEditableEgg = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope } = await adminContext();
		return service.getEditableEgg(scope, data.id);
	});

export const createAdminEgg = createServerFn({ method: "POST" })
	.validator(eggInputSchema)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		return service.createEgg(scope, actor, data);
	});

export const updateAdminEgg = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.updateEgg(scope, actor, data.id, data.input);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const publishAdminEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.publishEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const unpublishAdminEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.unpublishEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const archiveAdminEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.archiveEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const importAdminEggFromJson = createServerFn({ method: "POST" })
	.validator(importJsonInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		let parsed: unknown;
		try {
			parsed = JSON.parse(data.json);
		} catch {
			throw new Error("That doesn't look like valid egg JSON.");
		}
		return service.importEggFromJson(scope, actor, parsed);
	});

export const importAdminEggFromUrl = createServerFn({ method: "POST" })
	.validator(importUrlInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		return service.importEggFromUrl(scope, actor, data.url);
	});

export const deleteAdminEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.deleteEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});
