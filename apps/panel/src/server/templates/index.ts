import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrg } from "@/server/auth/guards";
import type { OwnerScope } from "./repository";
import type { Actor } from "./service";
import * as service from "./service";
import { templateInputSchema } from "./validation";

/**
 * Org templates service surface — the typed boundary the catalog/editor call.
 * Each function is a thin `auth + validate + delegate` shim: `requireOrg`
 * establishes (and re-verifies) the active org, the input is Zod-validated, and
 * the work is delegated to the shared service scoped to this org. The official
 * library lives next door under `server/admin/templates`. No SQL here.
 */

/** This request's org scope + actor, from a verified session. */
async function orgContext(): Promise<{ scope: OwnerScope; actor: Actor }> {
	const { orgId, userId, userName } = await requireOrg();
	return {
		scope: { kind: "org", orgId },
		actor: { userId, userName, orgId },
	};
}

const idInput = z.object({ id: z.uuid() });
const updateInput = z.object({ id: z.uuid(), input: templateInputSchema });
const importJsonInput = z.object({ json: z.string().min(1).max(512_000) });
const importUrlInput = z.object({ url: z.string().trim().min(1).max(2000) });

export const listTemplates = createServerFn({ method: "GET" }).handler(
	async () => {
		const { scope } = await orgContext();
		return service.listTemplates(scope);
	}
);

export const getEditableTemplate = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope } = await orgContext();
		return service.getEditableTemplate(scope, data.id);
	});

export const createTemplate = createServerFn({ method: "POST" })
	.validator(templateInputSchema)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		return service.createTemplate(scope, actor, data);
	});

export const updateTemplate = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
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

export const publishTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.publishTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const unpublishTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.unpublishTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const archiveTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.archiveTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const forkTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		// Fork needs the concrete org id; read it straight from the guard (which
		// throws if there's no active org) rather than narrowing the scope union.
		const { orgId, userId, userName } = await requireOrg();
		const result = await service.forkTemplate(
			orgId,
			{ userId, userName, orgId },
			data.id
		);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const importTemplateFromJson = createServerFn({ method: "POST" })
	.validator(importJsonInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		let parsed: unknown;
		try {
			parsed = JSON.parse(data.json);
		} catch {
			throw new Error("That doesn't look like valid template JSON.");
		}
		return service.importTemplateFromJson(scope, actor, parsed);
	});

export const importTemplateFromUrl = createServerFn({ method: "POST" })
	.validator(importUrlInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		return service.importTemplateFromUrl(scope, actor, data.url);
	});

export const deleteTemplate = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.deleteTemplate(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});
