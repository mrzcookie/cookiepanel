import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePlatformAdmin } from "@/server/auth/guards";
import type { OwnerScope } from "@/server/templates/repository";
import type { Actor } from "@/server/templates/service";
import * as service from "@/server/templates/service";
import { templateInputSchema } from "@/server/templates/validation";

/**
 * The official template library — the platform-owned (null-org) templates every
 * organization can deploy from, curated under /admin/templates. Same shared
 * service as the org surface, but gated on `requirePlatformAdmin` (the global
 * capability, NOT org membership — see guards.ts) and scoped to the official
 * library. Audit rows carry a null organizationId (a platform-level action),
 * mirroring the admin org-delete convention.
 *
 * There is no fork here: admins author official templates directly; "Customize"
 * is an org-side action that copies an official template *into* an org.
 */

const SCOPE: OwnerScope = { kind: "official" };

async function adminContext(): Promise<{ scope: OwnerScope; actor: Actor }> {
	const { userId, userName } = await requirePlatformAdmin();
	return { scope: SCOPE, actor: { userId, userName, orgId: null } };
}

const idInput = z.object({ id: z.uuid() });
const updateInput = z.object({ id: z.uuid(), input: templateInputSchema });
const importJsonInput = z.object({ json: z.string().min(1).max(512_000) });
const importUrlInput = z.object({ url: z.string().trim().min(1).max(2000) });

export const listAdminTemplates = createServerFn({ method: "GET" }).handler(
	async () => {
		const { scope } = await adminContext();
		return service.listTemplates(scope);
	}
);

export const getAdminEditableTemplate = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope } = await adminContext();
		return service.getEditableTemplate(scope, data.id);
	});

export const createAdminTemplate = createServerFn({ method: "POST" })
	.validator(templateInputSchema)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		return service.createTemplate(scope, actor, data);
	});

export const updateAdminTemplate = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.updateTemplate(
			scope,
			actor,
			data.id,
			data.input
		);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const publishAdminTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.publishTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const unpublishAdminTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.unpublishTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const archiveAdminTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.archiveTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const importAdminTemplateFromJson = createServerFn({ method: "POST" })
	.validator(importJsonInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		let parsed: unknown;
		try {
			parsed = JSON.parse(data.json);
		} catch {
			throw new Error("That doesn't look like valid template JSON.");
		}
		return service.importTemplateFromJson(scope, actor, parsed);
	});

export const importAdminTemplateFromUrl = createServerFn({ method: "POST" })
	.validator(importUrlInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		return service.importTemplateFromUrl(scope, actor, data.url);
	});

export const deleteAdminTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await adminContext();
		const result = await service.deleteTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});
