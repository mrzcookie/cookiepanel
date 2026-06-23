import dns from "node:dns/promises";
import net from "node:net";
import {
	CONFIG_PARSERS,
	type ConfigParser,
	type DoneMatcher,
	INSTALL_ENTRYPOINTS,
	type InstallEntrypoint,
	type StopType,
	TEMPLATE_CATEGORIES,
	type TemplateCategory,
	type TemplateConfigFile,
	type VariableAccess,
	type VariableType,
} from "@/lib/domain/templates";
import { isValidEnvName, type TemplateInputParsed } from "./validation";

/**
 * Bring a template in from an export. Two shapes are accepted, detected per
 * field rather than by a format flag:
 *  - a Pterodactyl / Pelican egg (`docker_images`, `env_variable`, Laravel-style
 *    rule strings), the dominant interchange format; and
 *  - CookiePanel's own export (`runtimes`, friendly `type` + `access`), so a
 *    template round-trips losslessly.
 *
 * Parsing is tolerant and never throws on bad input: it sanitises into our shape
 * (UPPER_SNAKE env names, a known category, bounded strings) and returns
 * `warnings` for anything dropped or truncated — the import always lands a draft
 * the author reviews before publishing. The result still passes
 * `templateInputSchema` in the service (the authoritative gate).
 */

export type EggImportResult = {
	input: TemplateInputParsed;
	/** A friendly name lifted from the source, for toasts/links. */
	name: string;
	warnings: string[];
};

// ─── tiny coercion helpers ───────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}
function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

const CATEGORY_SET = new Set<string>(TEMPLATE_CATEGORIES);

/** Best-effort category from the template's name/description keywords. */
function guessCategory(text: string): TemplateCategory {
	const t = text.toLowerCase();
	if (t.includes("minecraft")) return "Minecraft";
	if (/valheim|rust|ark|7 days|survival|palworld|conan/.test(t)) {
		return "Survival";
	}
	if (/factorio|terraria|sandbox|garry|starbound/.test(t)) return "Sandbox";
	if (/counter-strike|cs:?go|cs2|team fortress|tf2|fps|arma|squad/.test(t)) {
		return "FPS";
	}
	if (/teamspeak|mumble|ventrilo|voice|discord/.test(t)) return "Voice";
	if (/postgre|mysql|maria|redis|mongo|database|sql/.test(t)) return "Database";
	return "Other";
}

function normalizeCategory(
	raw: unknown,
	fallbackText: string
): TemplateCategory {
	const value = str(raw);
	return CATEGORY_SET.has(value)
		? (value as TemplateCategory)
		: guessCategory(fallbackText);
}

function normalizeEntrypoint(raw: unknown): InstallEntrypoint {
	const value = str(raw);
	return (INSTALL_ENTRYPOINTS as readonly string[]).includes(value)
		? (value as InstallEntrypoint)
		: "bash";
}

// ─── stop / done ─────────────────────────────────────────────────────────────

/** Map an egg/our stop into our typed stop. `^C` → SIGINT, `""` → native. */
function normalizeStop(raw: unknown): {
	stopType: StopType;
	stopValue: string;
} {
	// Our own export: { type, value }.
	const obj = asRecord(raw);
	if (typeof obj.type === "string") {
		const type = obj.type as StopType;
		if (type === "command" || type === "signal" || type === "native") {
			return { stopType: type, stopValue: str(obj.value).slice(0, 200) };
		}
	}
	// Egg: a bare string ("stop", "^C", "" / "^^C").
	const value = str(raw).trim();
	if (!value) return { stopType: "native", stopValue: "" };
	if (value.startsWith("^")) {
		const key = value.replace(/\^+/g, "").toUpperCase();
		const signal = key === "C" ? "SIGINT" : `SIG${key}`;
		return { stopType: "signal", stopValue: signal.slice(0, 200) };
	}
	return { stopType: "command", stopValue: value.slice(0, 200) };
}

/** Lift ready-signal markers from our `doneMarkers` or egg `config.startup`. */
function normalizeDoneMarkers(
	ours: unknown,
	eggStartup: unknown
): DoneMatcher[] {
	if (Array.isArray(ours)) {
		const markers: DoneMatcher[] = [];
		for (const entry of ours) {
			const obj = asRecord(entry);
			if (obj.kind === "regex" && str(obj.pattern)) {
				markers.push({
					kind: "regex",
					pattern: str(obj.pattern).slice(0, 512),
				});
			} else if (str(obj.value)) {
				markers.push({ kind: "string", value: str(obj.value).slice(0, 500) });
			}
		}
		return markers.slice(0, 20);
	}
	// Egg: config.startup is `{"done": "..."}` (sometimes a JSON string).
	let startup = eggStartup;
	if (typeof startup === "string") {
		try {
			startup = JSON.parse(startup);
		} catch {
			startup = {};
		}
	}
	const done = asRecord(startup).done;
	const values = Array.isArray(done) ? done : done == null ? [] : [done];
	return values
		.map(str)
		.filter(Boolean)
		.slice(0, 20)
		.map((value) => ({ kind: "string", value: value.slice(0, 500) }) as const);
}

// ─── images ──────────────────────────────────────────────────────────────────

function normalizeImages(
	root: Record<string, unknown>,
	warnings: string[]
): TemplateInputParsed["images"] {
	// Our export: runtimes: [{ label, image, isDefault }].
	if (Array.isArray(root.runtimes)) {
		const images = root.runtimes
			.map((entry) => asRecord(entry))
			.filter((r) => str(r.image).trim())
			.map((r) => ({
				label: (str(r.label).trim() || str(r.image).trim()).slice(0, 120),
				image: str(r.image).trim().slice(0, 500),
				isDefault: bool(r.isDefault, false),
			}));
		return ensureDefault(images);
	}
	// Egg: docker_images is a { label: image } map (label order preserved), or an
	// older `images: ["img1", "img2"]` array.
	const entries: { label: string; image: string }[] = [];
	const docker = root.docker_images;
	if (docker && typeof docker === "object" && !Array.isArray(docker)) {
		for (const [label, image] of Object.entries(docker)) {
			if (str(image).trim()) {
				entries.push({
					label: label.slice(0, 120),
					image: str(image).trim().slice(0, 500),
				});
			}
		}
	} else if (Array.isArray(root.images)) {
		for (const image of root.images) {
			if (str(image).trim()) {
				const ref = str(image).trim();
				entries.push({
					label: ref.split(":").pop()?.slice(0, 120) || ref,
					image: ref.slice(0, 500),
				});
			}
		}
	}
	if (entries.length === 0) {
		warnings.push(
			"No runtimes were found — add at least one before publishing."
		);
	}
	return ensureDefault(
		entries.slice(0, 30).map((e) => ({ ...e, isDefault: false }))
	);
}

/** Guarantee exactly one default runtime (the marked one, else the first). */
function ensureDefault(
	images: { label: string; image: string; isDefault: boolean }[]
): TemplateInputParsed["images"] {
	if (images.length === 0) return [];
	const defaultIndex = images.findIndex((image) => image.isDefault);
	const chosen = defaultIndex === -1 ? 0 : defaultIndex;
	return images.map((image, index) => ({
		...image,
		isDefault: index === chosen,
	}));
}

// ─── variables ───────────────────────────────────────────────────────────────

const RULE_OPTION = /(?:^|\|)\s*in:([^|]+)/i;

const VARIABLE_TYPE_SET = new Set<string>([
	"text",
	"number",
	"toggle",
	"select",
]);
const VARIABLE_ACCESS_SET = new Set<string>([
	"editable",
	"read-only",
	"hidden",
	"secret",
]);

/** Derive our friendly `type`/`access`/`required`/`options` from a variable. */
function normalizeVariable(
	raw: unknown,
	warnings: string[]
): TemplateInputParsed["variables"][number] | null {
	const v = asRecord(raw);

	// env name: prefer egg `env_variable`, then our `envVariable`.
	let env = str(v.env_variable || v.envVariable)
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9_]/g, "_");
	if (env && !/^[A-Z]/.test(env)) env = `V_${env}`;
	if (!isValidEnvName(env)) {
		warnings.push(
			`Skipped variable "${str(v.name) || env || "?"}" — unusable or reserved name.`
		);
		return null;
	}

	// Our export already carries a friendly type/access — trust it when present.
	const ourType = str(v.type) as VariableType;
	const ourAccess = str(v.access) as VariableAccess;
	const hasOurShape =
		(VARIABLE_TYPE_SET.has(ourType) && VARIABLE_ACCESS_SET.has(ourAccess)) ||
		v.type !== undefined ||
		v.access !== undefined;

	const rules = str(v.rules).toLowerCase();
	let type: VariableType;
	let options: string[] = [];
	let required: boolean;
	let access: VariableAccess;

	if (hasOurShape && VARIABLE_TYPE_SET.has(ourType)) {
		type = ourType;
		options = Array.isArray(v.options)
			? v.options.map(str).filter(Boolean)
			: [];
		required = bool(v.required, false);
		access = VARIABLE_ACCESS_SET.has(ourAccess) ? ourAccess : "editable";
	} else {
		// Egg: infer the control from the Laravel-style rule string.
		const optionMatch = RULE_OPTION.exec(rules);
		if (optionMatch) {
			type = "select";
			options = (optionMatch[1] ?? "")
				.split(",")
				.map((o) => o.trim())
				.filter(Boolean)
				.slice(0, 100);
		} else if (/(?:^|\|)\s*boolean\b/.test(rules)) {
			type = "toggle";
		} else if (/(?:^|\|)\s*(numeric|integer)\b/.test(rules)) {
			type = "number";
		} else {
			type = "text";
		}
		required = /(?:^|\|)\s*required\b/.test(rules);
		const viewable = bool(v.user_viewable ?? v.userViewable, true);
		const editable = bool(v.user_editable ?? v.userEditable, true);
		access = !viewable ? "hidden" : editable ? "editable" : "read-only";
	}

	const rawDefault = str(v.default_value ?? v.defaultValue);
	const defaultValue =
		access === "secret" || rawDefault === "" ? null : rawDefault.slice(0, 8000);

	return {
		name: (str(v.name).trim() || env).slice(0, 255),
		description: str(v.description).slice(0, 2000),
		envVariable: env,
		defaultValue,
		type,
		required,
		options,
		access,
	};
}

// ─── features ────────────────────────────────────────────────────────────────

const FEATURE_KEY = /^[a-z0-9-]+:[a-z0-9-]+$/;

function normalizeFeatures(raw: unknown): TemplateInputParsed["features"] {
	if (!Array.isArray(raw)) return [];
	const keys = new Set<string>();
	for (const entry of raw) {
		// Egg: a bare string. Ours: { key }.
		const key = (typeof entry === "string" ? entry : str(asRecord(entry).key))
			.trim()
			.toLowerCase();
		if (FEATURE_KEY.test(key)) {
			keys.add(key);
		}
	}
	return Array.from(keys)
		.slice(0, 50)
		.map((key) => ({ key }));
}

// ─── entry point ─────────────────────────────────────────────────────────────

export function parseEgg(raw: unknown): EggImportResult {
	const warnings: string[] = [];
	const root = asRecord(raw);

	const name = (str(root.name).trim() || "Imported template").slice(0, 120);
	const description = str(root.description);
	const summary = (str(root.summary) || description.split("\n")[0] || "").slice(
		0,
		300
	);

	const scripts = asRecord(asRecord(root.scripts).installation);
	const ourInstall = asRecord(root.install);
	const config = asRecord(root.config);

	const installScript = str(scripts.script || ourInstall.script);
	if (installScript.length > 64_000) {
		warnings.push("The install script was truncated to 64 KB.");
	}

	const startupCommand = str(root.startupCommand || root.startup).slice(
		0,
		4000
	);
	const { stopType, stopValue } = normalizeStop(
		config.stop !== undefined ? config.stop : root.stop
	);

	const variables = Array.isArray(root.variables)
		? root.variables
				.map((entry) => normalizeVariable(entry, warnings))
				.filter((v): v is NonNullable<typeof v> => v !== null)
				.slice(0, 200)
		: [];

	const input: TemplateInputParsed = {
		name,
		summary,
		description: description.slice(0, 20_000),
		category: normalizeCategory(root.category, `${name} ${description}`),
		iconUrl: null,
		images: normalizeImages(root, warnings),
		variables,
		startupCommand,
		stopType,
		stopValue,
		doneMarkers: normalizeDoneMarkers(root.doneMarkers, config.startup),
		installScript: installScript.slice(0, 64_000),
		installContainerImage: str(
			scripts.container || ourInstall.containerImage
		).slice(0, 500),
		installEntrypoint: normalizeEntrypoint(
			scripts.entrypoint || ourInstall.entrypoint
		),
		features: normalizeFeatures(root.features),
		configFiles: normalizeConfigFiles(config.files, warnings),
	};

	return { input, name, warnings };
}

// ─── config files ────────────────────────────────────────────────────────────

/** Translate a Pterodactyl config token to the panel's {{KEY}} space. Unknown
 * tokens are left untouched (they simply won't resolve at deploy). */
function normalizeConfigTokens(value: string): string {
	return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, inner: string) => {
		const token = inner.trim();
		if (token === "server.build.default.port") {
			return "{{SERVER_PORT}}";
		}
		if (token === "server.build.default.ip") {
			return "{{SERVER_IP}}";
		}
		if (
			token === "server.build.memory" ||
			token === "server.build.default.memory"
		) {
			return "{{SERVER_MEMORY}}";
		}
		const env = /^(?:server\.build\.)?env\.([A-Za-z0-9_]+)$/.exec(token);
		if (env) {
			return `{{${env[1]}}}`;
		}
		return whole; // leave unrecognized tokens as-is
	});
}

/**
 * Parse a Pterodactyl/Pelican egg's `config.files` — a map (or stringified map)
 * of `filename → { parser, find }` — into the panel's config-file list, with
 * tokens normalized. Files with an unknown parser or no replacements are dropped
 * (with a warning), so a deploy never half-applies a config it can't write.
 */
function normalizeConfigFiles(
	raw: unknown,
	warnings: string[]
): TemplateConfigFile[] {
	let parsed = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			warnings.push("Couldn't parse the egg's config files; skipped them.");
			return [];
		}
	}
	const files = asRecord(parsed);
	const out: TemplateConfigFile[] = [];
	for (const [file, spec] of Object.entries(files)) {
		const record = asRecord(spec);
		const parser = str(record.parser).toLowerCase();
		if (!(CONFIG_PARSERS as readonly string[]).includes(parser)) {
			warnings.push(`Skipped config file "${file}": unsupported parser.`);
			continue;
		}
		const find = asRecord(record.find);
		const replace: Record<string, string> = {};
		for (const [key, value] of Object.entries(find)) {
			// Egg find-values are usually strings, occasionally numbers/booleans.
			const asString = typeof value === "string" ? value : String(value ?? "");
			replace[key] = normalizeConfigTokens(asString);
		}
		if (Object.keys(replace).length === 0) {
			continue;
		}
		out.push({ file, parser: parser as ConfigParser, replace });
		if (out.length >= 50) {
			break;
		}
	}
	return out;
}

// ─── SSRF-safe remote fetch ──────────────────────────────────────────────────

const MAX_EGG_BYTES = 2 * 1024 * 1024; // 2 MB is ample for any egg.

/** Private / loopback / link-local / CGNAT ranges an import must never reach. */
function isPrivateIp(ip: string): boolean {
	if (net.isIPv4(ip)) {
		const parts = ip.split(".");
		const a = Number(parts[0] ?? 0);
		const b = Number(parts[1] ?? 0);
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true; // link-local + cloud metadata
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
		return false;
	}
	const v = ip.toLowerCase();
	if (v === "::1" || v === "::") return true;
	if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) {
		return true;
	}
	if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
	return false;
}

/**
 * https-only, and every resolved address must be public.
 *
 * NOTE — residual DNS-rebinding (TOCTOU): we validate the addresses this lookup
 * returns, but the subsequent `fetch` resolves the hostname again independently,
 * so a host that answers with a public IP here and a private one to `fetch` could
 * slip through. Closing it fully needs the connection pinned to the vetted IP
 * (an IP-pinned dispatcher), which isn't wired without pulling in `undici`
 * directly — tracked as a follow-up. Mitigated meanwhile by https-only,
 * `redirect: "error"`, the size/time bounds below, and this being a
 * member/admin-gated action.
 */
async function assertSafeUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Enter a valid URL.");
	}
	if (url.protocol !== "https:") {
		throw new Error("The URL must start with https://.");
	}
	const lookups = await dns.lookup(url.hostname, { all: true }).catch(() => []);
	if (lookups.length === 0) {
		throw new Error("Couldn't resolve that host.");
	}
	for (const { address } of lookups) {
		if (isPrivateIp(address)) {
			throw new Error("That URL points at a private address.");
		}
	}
	return url;
}

/** Read a response body up to `MAX_EGG_BYTES`, aborting as soon as it's exceeded
 *  (so a hostile origin can't stream gigabytes into memory past the cap). */
async function readBounded(response: Response): Promise<string> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_EGG_BYTES) {
		throw new Error("That file is too large to import.");
	}
	const reader = response.body?.getReader();
	if (!reader) {
		return "";
	}
	const decoder = new TextDecoder();
	let out = "";
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > MAX_EGG_BYTES) {
			await reader.cancel();
			throw new Error("That file is too large to import.");
		}
		out += decoder.decode(value, { stream: true });
	}
	return out + decoder.decode();
}

/** Fetch egg JSON from a public https URL, size- and time-bounded. */
export async function fetchEggJson(rawUrl: string): Promise<unknown> {
	const url = await assertSafeUrl(rawUrl);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: "error", // a redirect could dodge the SSRF check — refuse it.
			headers: { accept: "application/json, text/plain" },
		});
		if (!response.ok) {
			throw new Error(`The server returned ${response.status}.`);
		}
		const body = await readBounded(response);
		try {
			return JSON.parse(body);
		} catch {
			throw new Error("That URL didn't return valid template JSON.");
		}
	} finally {
		clearTimeout(timer);
	}
}
