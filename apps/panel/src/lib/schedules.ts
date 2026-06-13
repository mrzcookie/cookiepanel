// Schedule domain types + pure, client-safe helpers.
//
// A Schedule is daemon-side cron automation for a server: a trigger (how often)
// plus an ordered list of typed steps the daemon runs in sequence. Lives on the
// box so it fires while the panel is offline. This module is pure (no stub data,
// no React); the mutable store is schedules-store.ts.

export type PowerAction = "start" | "stop" | "restart";

export type ScheduleStep =
	| { id: string; kind: "command"; command: string }
	| { id: string; kind: "wait"; seconds: number }
	| { id: string; kind: "power"; action: PowerAction }
	| { id: string; kind: "backup" };

export type ScheduleStepKind = ScheduleStep["kind"];

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

export const FREQUENCIES: ScheduleFrequency[] = ["hourly", "daily", "weekly"];

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
