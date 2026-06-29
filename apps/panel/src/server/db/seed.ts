import { randomUUID } from "node:crypto";
import { EGGS } from "@/lib/stubs";
import { db } from "@/server/db";
import { egg, eggImage, eggVariable } from "@/server/db/schema/eggs";

/**
 * Seed the **official** (platform-owned) egg library from the UI-first stub
 * records, so the catalog renders the same curated library the panel always
 * showed. Official eggs are the null-org rows every organization can deploy
 * from; org-owned stub eggs are *not* seeded (they belong to no real org).
 *
 * Idempotent: keyed on the egg id (the stub's stable UUID, preserved so any
 * stubbed server's `eggId` still resolves), it inserts an egg once and
 * skips it on re-run. Run with `bun run db:seed` (after `bun run db:migrate`).
 */
async function seed() {
	const official = EGGS.filter((t) => t.official);
	let created = 0;

	for (const t of official) {
		const inserted = await db
			.insert(egg)
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
			.onConflictDoNothing({ target: egg.id })
			.returning({ id: egg.id });

		// Already seeded — leave its children untouched.
		if (inserted.length === 0) {
			continue;
		}

		if (t.images.length > 0) {
			await db.insert(eggImage).values(
				t.images.map((image, index) => ({
					id: randomUUID(),
					eggId: t.id,
					label: image.label,
					image: image.image,
					isDefault: image.isDefault,
					sortOrder: index,
				}))
			);
		}
		if (t.variables.length > 0) {
			await db.insert(eggVariable).values(
				t.variables.map((variable, index) => ({
					id: randomUUID(),
					eggId: t.id,
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
		`Seeded ${created} new official egg${created === 1 ? "" : "s"} (${official.length - created} already present).`
	);
}

seed()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Seed failed:", error);
		process.exit(1);
	});
