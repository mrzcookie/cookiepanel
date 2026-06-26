import { z } from "zod";
import {
	CONFIG_PARSERS,
	EGG_CATEGORIES,
	INSTALL_ENTRYPOINTS,
	STOP_TYPES,
	VARIABLE_ACCESSES,
	VARIABLE_TYPES,
} from "@/lib/domain/eggs";
import { slugify } from "@/lib/slug";

/**
 * Server-side validation for the egg authoring surface. The editor already
 * validates the friendly form (a name, an UPPER_SNAKE key, one access choice),
 * so this is the backstop: it re-checks every field, bounds lengths so a single
 * egg can't be enormous, and rejects reserved env names — the same input
 * whether it arrived from the editor, an egg import, or a crafted request.
 */

/** Env names the daemon injects itself; an author can't redefine them. */
const RESERVED_ENV_VARS = new Set([
	"STARTUP",
	"SERVER_MEMORY",
	"SERVER_IP",
	"SERVER_PORT",
	"SERVER_CPU",
	"SERVER_DISK",
	"SERVER_UUID",
	"UUID",
	"INTERNAL_IP",
	"TZ",
	"LANG",
	"PATH",
	"HOME",
	"USER",
	"PWD",
	"SHELL",
	"TERM",
	"HOSTNAME",
]);

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,254}$/;

/** A valid, non-reserved environment variable name (UPPER_SNAKE_CASE). */
export function isValidEnvName(name: string): boolean {
	return ENV_NAME.test(name) && !RESERVED_ENV_VARS.has(name);
}

const doneMatcherSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("string"), value: z.string().min(1).max(500) }),
	z.object({ kind: z.literal("regex"), pattern: z.string().min(1).max(512) }),
]);

const featureSchema = z.object({
	// `namespace:capability`, e.g. `minecraft:eula` — no whitespace/metacharacters.
	key: z
		.string()
		.min(1)
		.max(100)
		.regex(/^[a-z0-9-]+:[a-z0-9-]+$/, "Invalid feature key"),
});

const imageSchema = z.object({
	label: z.string().trim().min(1).max(120),
	image: z.string().trim().min(1).max(500),
	isDefault: z.boolean(),
});

const variableSchema = z
	.object({
		name: z.string().trim().min(1).max(255),
		description: z.string().max(2000).default(""),
		envVariable: z.string().trim().min(1).max(255),
		defaultValue: z.string().max(8000).nullable().default(null),
		type: z.enum(VARIABLE_TYPES),
		required: z.boolean(),
		options: z.array(z.string().max(255)).max(100).default([]),
		access: z.enum(VARIABLE_ACCESSES),
	})
	.superRefine((variable, ctx) => {
		if (!isValidEnvName(variable.envVariable)) {
			ctx.addIssue({
				code: "custom",
				message: `Invalid or reserved variable name: ${variable.envVariable}`,
				path: ["envVariable"],
			});
		}
	});

const configFileSchema = z.object({
	file: z.string().trim().min(1).max(500),
	parser: z.enum(CONFIG_PARSERS),
	replace: z.record(z.string().max(500), z.string().max(4000)).default({}),
});

/** The author-editable slice of an egg — what create/update accept. */
export const eggInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	summary: z.string().max(300).default(""),
	description: z.string().max(20000).default(""),
	category: z.enum(EGG_CATEGORIES),
	iconUrl: z.string().max(512_000).nullable().default(null),
	images: z.array(imageSchema).max(30).default([]),
	variables: z.array(variableSchema).max(200).default([]),
	startupCommand: z.string().max(4000).default(""),
	stopType: z.enum(STOP_TYPES),
	stopValue: z.string().max(200).default("stop"),
	doneMarkers: z.array(doneMatcherSchema).max(20).default([]),
	installScript: z.string().max(64_000).default(""),
	installContainerImage: z.string().max(500).default(""),
	installEntrypoint: z.enum(INSTALL_ENTRYPOINTS),
	features: z.array(featureSchema).max(50).default([]),
	configFiles: z.array(configFileSchema).max(50).default([]),
});

export type EggInputParsed = z.infer<typeof eggInputSchema>;

/**
 * A slug unique within a scope. Starts from the name, falls back to a constant,
 * then appends `-2`, `-3`, … until it doesn't collide. `exclude` skips the
 * egg's own current slug so a no-op rename keeps it.
 */
export function uniqueSlug(
	name: string,
	taken: string[],
	exclude?: string
): string {
	const base = slugify(name) || "untitled-egg";
	const used = new Set(taken.filter((slug) => slug !== exclude));
	if (!used.has(base)) {
		return base;
	}
	for (let n = 2; n < 10_000; n++) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) {
			return candidate;
		}
	}
	// Unreachable in practice; keep the type honest.
	return `${base}-${taken.length + 1}`;
}
