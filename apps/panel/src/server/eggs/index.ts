import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireOrg } from "@/server/auth/guards";
import { validateImageUpload } from "@/server/storage/image-upload";
import { uploadManagedImage } from "@/server/storage/managed-image";
import { EGG_ICON_PREFIX } from "./icon";
import type { OwnerScope } from "./repository";
import type { Actor } from "./service";
import * as service from "./service";
import { eggInputSchema } from "./validation";

/**
 * Org eggs service surface — the typed boundary the catalog/editor call.
 * Each function is a thin `auth + validate + delegate` shim: `requireOrg`
 * establishes (and re-verifies) the active org, the input is Zod-validated, and
 * the work is delegated to the shared service scoped to this org. The official
 * library lives next door under `server/admin/eggs`. No SQL here.
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
const updateInput = z.object({ id: z.uuid(), input: eggInputSchema });
const importJsonInput = z.object({ json: z.string().min(1).max(512_000) });
const importUrlInput = z.object({ url: z.string().trim().min(1).max(2000) });

export const listEggs = createServerFn({ method: "GET" }).handler(async () => {
	const { scope } = await orgContext();
	return service.listEggs(scope);
});

export const getEditableEgg = createServerFn({ method: "GET" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope } = await orgContext();
		return service.getEditableEgg(scope, data.id);
	});

export const createEgg = createServerFn({ method: "POST" })
	.validator(eggInputSchema)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		return service.createEgg(scope, actor, data);
	});

/**
 * Upload an egg icon to object storage and return its URL for the editor to save
 * on the egg. Decoupled from create/update because a brand-new egg has no id yet:
 * the key is minted server-side under the caller's verified org namespace, and
 * the URL only becomes the egg's icon once the editor saves it.
 */
export const uploadEggIcon = createServerFn({ method: "POST" })
	.validator(validateImageUpload)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const { url } = await uploadManagedImage({
			prefix: EGG_ICON_PREFIX,
			ownerId: orgId,
			file: data.file,
		});
		return { iconUrl: url };
	});

export const updateEgg = createServerFn({ method: "POST" })
	.validator(updateInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.updateEgg(scope, actor, data.id, data.input);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const publishEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.publishEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const unpublishEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.unpublishEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const archiveEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.archiveEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const forkEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		// Fork needs the concrete org id; read it straight from the guard (which
		// throws if there's no active org) rather than narrowing the scope union.
		const { orgId, userId, userName } = await requireOrg();
		const result = await service.forkEgg(
			orgId,
			{ userId, userName, orgId },
			data.id
		);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});

export const importEggFromJson = createServerFn({ method: "POST" })
	.validator(importJsonInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		let parsed: unknown;
		try {
			parsed = JSON.parse(data.json);
		} catch {
			throw new Error("That doesn't look like valid egg JSON.");
		}
		return service.importEggFromJson(scope, actor, parsed);
	});

export const importEggFromUrl = createServerFn({ method: "POST" })
	.validator(importUrlInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		return service.importEggFromUrl(scope, actor, data.url);
	});

export const deleteEgg = createServerFn({ method: "POST" })
	.validator(idInput)
	.handler(async ({ data }) => {
		const { scope, actor } = await orgContext();
		const result = await service.deleteEgg(scope, actor, data.id);
		if (!result) {
			throw new Error("Not found");
		}
		return result;
	});
