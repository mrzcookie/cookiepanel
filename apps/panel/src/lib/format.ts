// Small display formatters for the UI-first phase. Keep these pure and shared so
// a value (bytes, a count) reads identically in a grid card and a table row.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Human-friendly bytes (binary base, decimal-style labels — what a non-admin
 * expects to see). Whole numbers below TB drop their decimals; TB and up keep
 * one. `formatBytes(64 * 1024 ** 3)` → "64 GB", `formatBytes(2 * 1024 ** 4)` →
 * "2.0 TB". Zero (and any non-finite input) reads "0 B" — the helper is reused
 * at byte scale (table/key sizes), so a zero must not render as "0 GB".
 */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 B";
	}
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		BYTE_UNITS.length - 1
	);
	const value = bytes / 1024 ** exponent;
	const decimals = exponent >= 4 || !Number.isInteger(value) ? 1 : 0;
	return `${value.toFixed(decimals)} ${BYTE_UNITS[exponent]}`;
}

/**
 * A name's first + last initial, for an avatar fallback when there's no image:
 * `initials("Jane Cooper")` → "JC", `initials("Jane")` → "J". Empty for a blank
 * or missing name — the caller then shows an icon instead.
 */
export function initials(name: string | undefined | null): string {
	const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
	const first = parts.at(0)?.charAt(0) ?? "";
	const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? "") : "";
	return (first + last).toUpperCase();
}

/** Pluralize a count with its noun: `pluralize(1, "server")` → "1 server". */
export function pluralize(count: number, noun: string): string {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * A whole number with thousands separators: `formatCount(2481900)` → "2,481,900".
 * Deterministic (not locale-dependent) so SSR and the client agree.
 */
export function formatCount(value: number): string {
	return Math.round(value)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * USD from a cent amount, thousands-separated, dropping the cents when whole:
 * `formatMoney(1000)` → "$10", `formatMoney(1250)` → "$12.50",
 * `formatMoney(-1250)` → "-$12.50" (the sign sits outside the "$", for
 * credits/refunds). Deterministic (not locale-dependent) so SSR and the client
 * agree. Prices are stored in cents to mirror Polar (and to avoid float drift).
 */
export function formatMoney(cents: number): string {
	const negative = cents < 0;
	const dollars = Math.abs(cents) / 100;
	const fixed = Number.isInteger(dollars)
		? String(dollars)
		: dollars.toFixed(2);
	const [whole = "0", fraction] = fixed.split(".");
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	const body = fraction ? `${grouped}.${fraction}` : grouped;
	return `${negative ? "-" : ""}$${body}`;
}

/**
 * A calendar date like "Jun 11, 2026" (fixed en-US locale). Locale is pinned so
 * the month abbreviation is stable, but this reads the viewer's timezone — use it
 * for client-rendered, session-derived dates (where there's no SSR markup to
 * mismatch), not inside SSR'd output.
 */
export function formatDate(value: string | Date): string {
	const date = typeof value === "string" ? new Date(value) : value;
	if (Number.isNaN(date.getTime())) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(date);
}

/**
 * A short relative time — "just now", "5 minutes ago", "Yesterday" — falling back
 * to an absolute date past a week. Depends on the current time, so it differs
 * between SSR and the client; render it under `suppressHydrationWarning` (the
 * activity list does).
 */
export function formatRelativeTime(value: string | Date): string {
	const date = typeof value === "string" ? new Date(value) : value;
	const ms = date.getTime();
	if (Number.isNaN(ms)) {
		return "—";
	}
	const seconds = Math.floor((Date.now() - ms) / 1000);
	if (seconds < 60) {
		return "just now";
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${pluralize(minutes, "minute")} ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${pluralize(hours, "hour")} ago`;
	}
	const days = Math.floor(hours / 24);
	if (days === 1) {
		return "Yesterday";
	}
	if (days < 7) {
		return `${days} days ago`;
	}
	return formatDate(date);
}
