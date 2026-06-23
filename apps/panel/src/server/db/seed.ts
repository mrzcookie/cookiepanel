import { randomUUID } from "node:crypto";
import { TEMPLATES } from "@/lib/stubs";
import { db } from "@/server/db";
import {
	template,
	templateImage,
	templateVariable,
} from "@/server/db/schema/templates";

/**
 * Seed the **official** (platform-owned) template library from the UI-first stub
 * records, so the catalog renders the same curated library the panel always
 * showed. Official templates are the null-org rows every organization can deploy
 * from; org-owned stub templates are *not* seeded (they belong to no real org).
 *
 * Idempotent: keyed on the template id (the stub's stable UUID, preserved so any
 * stubbed server's `templateId` still resolves), it inserts a template once and
 * skips it on re-run. Run with `pnpm db:seed` (after `pnpm db:migrate`).
 */
async function seed() {
	const official = TEMPLATES.filter((t) => t.official);
	let created = 0;

	for (const t of official) {
		const inserted = await db
			.insert(template)
			.values({
				id: t.id,
				organizationId: null,
				name: t.name,
				slug: t.slug,
				summary: t.summary,
				description: t.description,
				category: t.category,
				iconUrl: t.iconUrl,
				origin: t.origin,
				status: t.status,
				version: t.version,
				parentName: t.parentName,
				startupCommand: t.startupCommand,
				stopType: t.stopType,
				stopValue: t.stopValue,
				doneMarkers: t.doneMarkers,
				installScript: t.installScript,
				installContainerImage: t.installContainerImage,
				installEntrypoint: t.installEntrypoint,
				features: t.features,
				configFiles: t.configFiles,
			})
			.onConflictDoNothing({ target: template.id })
			.returning({ id: template.id });

		// Already seeded — leave its children untouched.
		if (inserted.length === 0) {
			continue;
		}

		if (t.images.length > 0) {
			await db.insert(templateImage).values(
				t.images.map((image, index) => ({
					id: randomUUID(),
					templateId: t.id,
					label: image.label,
					image: image.image,
					isDefault: image.isDefault,
					sortOrder: index,
				}))
			);
		}
		if (t.variables.length > 0) {
			await db.insert(templateVariable).values(
				t.variables.map((variable, index) => ({
					id: randomUUID(),
					templateId: t.id,
					name: variable.name,
					description: variable.description,
					envVariable: variable.envVariable,
					defaultValue: variable.defaultValue,
					type: variable.type,
					required: variable.required,
					options: variable.options,
					access: variable.access,
					sortOrder: index,
				}))
			);
		}
		created += 1;
		// biome-ignore lint/suspicious/noConsole: progress output for a CLI seed.
		console.log(`  + ${t.name}`);
	}

	// biome-ignore lint/suspicious/noConsole: summary output for a CLI seed.
	console.log(
		`Seeded ${created} new official template${created === 1 ? "" : "s"} (${official.length - created} already present).`
	);
}

seed()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Seed failed:", error);
		process.exit(1);
	});
