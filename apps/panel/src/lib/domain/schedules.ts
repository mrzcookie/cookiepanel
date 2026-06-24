// Schedule domain types + pure, client-safe helpers.
//
// A Schedule is daemon-side cron automation for a server: a trigger (how often)
// plus an ordered list of typed steps the daemon runs in sequence. Lives on the
// box so it fires while the panel is offline. The panel exposes a friendly
// trigger (hourly / daily / weekly + time); the server layer translates that to
// the 5-field cron the daemon stores, and back. This module is pure (no React).

export type PowerAction = "start" | "stop" | "restart";

export type ScheduleStep =
	| { id: string; kind: "command"; command: string }
	| { id: string; kind: "wait"; seconds: number }
	| { id: string; kind: "power"; action: PowerAction }
	| { id: string; kind: "backup" };

export type ScheduleStepKind = ScheduleStep["kind"];

// Step kinds the wizard offers. `backup` is intentionally excluded until the
// backups slice — the daemon rejects backup steps for now.
export const SCHEDULE_STEP_KINDS: ScheduleStepKind[] = [
	"command",
	"wait",
	"power",
];

export type ScheduleFrequency = "hourly" | "daily" | "weekly";

export type Schedule = {
	id: string;
	serverId: string;
	name: string;
	frequency: ScheduleFrequency;
	/** "HH:MM" — used by daily / weekly. */
	time: string;
	/** 0 = Sunday … 6 = Saturday — used by weekly. */
	dayOfWeek: number;
	enabled: boolean;
	/** Pre-formatted; null until it's run once. */
	lastRun: string | null;
	/** Outcome of the last run, when it has run. */
	lastStatus: "ok" | "error" | null;
	/** Failure detail when lastStatus is "error". */
	lastError: string | null;
	/** Pre-formatted friendly next-run time. */
	nextRun: string;
	steps: ScheduleStep[];
};

/** The author-editable slice the wizard produces. */
export type ScheduleInput = {
	name: string;
	frequency: ScheduleFrequency;
	time: string;
	dayOfWeek: number;
	steps: ScheduleStep[];
};

export const DAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

/** Newcomer-facing copy for each step type, shown in the wizard's step picker. */
export const STEP_META: Record<
	ScheduleStepKind,
	{ label: string; description: string }
> = {
	command: {
		label: "Send a command",
		description: "Type a line into the server console (e.g. say or stop).",
	},
	wait: {
		label: "Wait",
		description: "Pause for a few seconds before the next step.",
	},
	power: {
		label: "Power",
		description: "Start, stop, or restart the server.",
	},
	backup: {
		label: "Back up",
		description: "Snapshot the server's data volume.",
	},
};

/** A friendly description of when a schedule fires. */
export function frequencyLabel(
	schedule: Pick<Schedule, "frequency" | "time" | "dayOfWeek">
): string {
	if (schedule.frequency === "hourly") {
		return "Every hour";
	}
	if (schedule.frequency === "daily") {
		return `Every day at ${schedule.time}`;
	}
	return `Every ${DAYS[schedule.dayOfWeek]} at ${schedule.time}`;
}

/** A friendly one-line description of a single step. */
export function stepSummary(step: ScheduleStep): string {
	switch (step.kind) {
		case "command":
			return `Send “${step.command || "…"}” to the console`;
		case "wait":
			return `Wait ${step.seconds} second${step.seconds === 1 ? "" : "s"}`;
		case "power":
			if (step.action === "start") {
				return "Start the server";
			}
			return step.action === "stop" ? "Stop the server" : "Restart the server";
		default:
			return "Back up the server";
	}
}

/** A fresh step of a given kind, with sensible defaults. */
export function newStep(kind: ScheduleStepKind, id: string): ScheduleStep {
	switch (kind) {
		case "command":
			return { id, kind, command: "" };
		case "wait":
			return { id, kind, seconds: 5 };
		case "power":
			return { id, kind, action: "restart" };
		default:
			return { id, kind: "backup" };
	}
}

/** Whether a step is filled in enough to save. */
export function stepValid(step: ScheduleStep): boolean {
	if (step.kind === "command") {
		return step.command.trim() !== "";
	}
	if (step.kind === "wait") {
		return Number.isInteger(step.seconds) && step.seconds >= 1;
	}
	return true;
}

/** A friendly next-run string from the trigger (UI-first approximation). */
export function computeNextRun(
	input: Pick<ScheduleInput, "frequency" | "time" | "dayOfWeek">
): string {
	if (input.frequency === "hourly") {
		return "Within the hour";
	}
	if (input.frequency === "daily") {
		return `Tomorrow at ${input.time}`;
	}
	return `Next ${DAYS[input.dayOfWeek]} at ${input.time}`;
}

// ─── cron translation ────────────────────────────────────────────────────────
// The daemon stores a 5-field cron; the panel works in the friendly trigger. The
// panel only ever generates the simple shapes below, so the round-trip is exact;
// an unrecognized cron (created outside the panel) falls back to a daily default.

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" → [hour, minute], clamped to valid ranges. */
function parseTime(time: string): [number, number] {
	const parts = time.split(":");
	const h = Number.parseInt(parts[0] ?? "", 10);
	const m = Number.parseInt(parts[1] ?? "", 10);
	const hour = Number.isNaN(h) ? 0 : Math.min(Math.max(h, 0), 23);
	const min = Number.isNaN(m) ? 0 : Math.min(Math.max(m, 0), 59);
	return [hour, min];
}

/** Build a 5-field cron (min hour dom mon dow) from the friendly trigger. */
export function frequencyToCron(
	input: Pick<ScheduleInput, "frequency" | "time" | "dayOfWeek">
): string {
	const [hour, min] = parseTime(input.time);
	if (input.frequency === "hourly") {
		return `${min} * * * *`;
	}
	if (input.frequency === "daily") {
		return `${min} ${hour} * * *`;
	}
	return `${min} ${hour} * * ${input.dayOfWeek}`;
}

/** Parse a panel-generated cron back into the friendly trigger (best-effort). */
export function cronToTrigger(cron: string): {
	frequency: ScheduleFrequency;
	time: string;
	dayOfWeek: number;
} {
	const parts = cron.trim().split(/\s+/);
	if (parts.length === 5) {
		const [minF, hourF, dom, mon, dow] = parts;
		const min = Number(minF);
		const hour = Number(hourF);
		const minOk = Number.isInteger(min) && min >= 0 && min <= 59;
		if (dom === "*" && mon === "*" && minOk) {
			if (hourF === "*" && dow === "*") {
				return { frequency: "hourly", time: `00:${pad(min)}`, dayOfWeek: 0 };
			}
			const hourOk = Number.isInteger(hour) && hour >= 0 && hour <= 23;
			if (hourOk) {
				const time = `${pad(hour)}:${pad(min)}`;
				if (dow === "*") {
					return { frequency: "daily", time, dayOfWeek: 0 };
				}
				const day = Number(dow);
				if (Number.isInteger(day) && day >= 0 && day <= 6) {
					return { frequency: "weekly", time, dayOfWeek: day };
				}
			}
		}
	}
	return { frequency: "daily", time: "00:00", dayOfWeek: 0 };
}
