// Small display formatters for the UI-first phase. Keep these pure and shared so
// a value (bytes, a count) reads identically in a grid card and a table row.

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Human-friendly bytes (binary base, decimal-style labels — what a non-admin
 * expects to see). Whole numbers below TB drop their decimals; TB and up keep
 * one. `formatBytes(64 * 1024 ** 3)` → "64 GB", `formatBytes(2 * 1024 ** 4)` →
 * "2.0 TB".
 */
export function formatBytes(bytes: number): string {
	if (bytes <= 0) {
		return "0 GB";
	}
	const exponent = Math.min(
		Math.floor(Math.log(bytes) / Math.log(1024)),
		BYTE_UNITS.length - 1
	);
	const value = bytes / 1024 ** exponent;
	const decimals = exponent >= 4 || !Number.isInteger(value) ? 1 : 0;
	return `${value.toFixed(decimals)} ${BYTE_UNITS[exponent]}`;
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
