import { env } from "@/server/env";

/**
 * A tiny, dependency-free leveled server logger. Server-only — it reads `env`
 * (LOG_LEVEL), so it must never reach the client bundle. The single replacement
 * for scattered `console.*` in `src/server`: every line honors `env.LOG_LEVEL`
 * (debug < info < warn < error), carries a consistent `[level] message` prefix,
 * and appends structured `key=value` fields.
 *
 * **Redaction is a name filter, not a value scrubber.** Every field set is run
 * through `redact()`, which replaces the value of any field whose *name* looks
 * secret (`nodeKey`, `signingSecret`, `Authorization`, `apiToken`, …) with
 * `[redacted]`. It does NOT inspect values, so a secret logged under an
 * innocuous field name still leaks — the real defense is call sites not passing
 * secrets in; this is only a backstop against secret-named fields.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const threshold = LEVEL_WEIGHT[env.LOG_LEVEL];

// Field names whose values are secret (or secret-adjacent) and must never be
// written. Matched case-insensitively as a substring, so `nodeKey`,
// `signingSecret`, `Authorization`, `apiToken`, etc. are all caught.
const SENSITIVE_KEY =
	/(authorization|bearer|password|secret|token|nodekey|signing|apikey|api_key|encryption|credential)/i;

const REDACTED = "[redacted]";

/**
 * Replace the values of secret-*named* fields with `[redacted]`, leaving the
 * rest untouched. Matches on the field name only (not the value). Exported so
 * call sites can pre-redact a payload before logging, but the logger also
 * applies it to every line as a backstop.
 */
export function redact(fields: LogFields): LogFields {
	const out: LogFields = {};
	for (const [key, value] of Object.entries(fields)) {
		out[key] = SENSITIVE_KEY.test(key) ? REDACTED : value;
	}
	return out;
}

function formatValue(value: unknown): string {
	if (value instanceof Error) {
		return value.message;
	}
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value == null
	) {
		return String(value);
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function formatFields(fields: LogFields): string {
	const safe = redact(fields);
	const parts: string[] = [];
	for (const [key, value] of Object.entries(safe)) {
		parts.push(`${key}=${formatValue(value)}`);
	}
	return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
	if (LEVEL_WEIGHT[level] < threshold) {
		return;
	}
	const line = `[${level}] ${message}${fields ? formatFields(fields) : ""}`;
	// This is the one sanctioned console sink — every server log line funnels here.
	// biome-ignore lint/suspicious/noConsole: the leveled logger's single output.
	console[level](line);
}

export const log = {
	debug: (message: string, fields?: LogFields) =>
		emit("debug", message, fields),
	info: (message: string, fields?: LogFields) => emit("info", message, fields),
	warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
	error: (message: string, fields?: LogFields) =>
		emit("error", message, fields),
};
