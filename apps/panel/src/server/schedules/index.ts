import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DaemonRead } from "@/lib/domain/nodes";
import {
	computeNextRun,
	cronToTrigger,
	frequencyToCron,
	type PowerAction,
	type Schedule,
	type ScheduleStep,
} from "@/lib/domain/schedules";
import { formatRelativeTime } from "@/lib/format";
import { requireServerNode } from "@/server/files/service";
import {
	DaemonError,
	type DaemonSchedule,
	type DaemonScheduleStep,
	deleteNodeSchedule,
	getNodeSchedules,
	runNodeSchedule,
	upsertNodeSchedule,
} from "@/server/nodes/daemon-client";

/**
 * Schedule server functions. Schedules are **daemon-owned** (the box's cron runs
 * them, persisted locally so they fire offline) — like networks/firewall, reads
 * dial the node on demand and degrade to `{ ok: false }` when it's unreachable.
 * The panel works in a friendly trigger (hourly/daily/weekly + time); this layer
 * translates that to/from the daemon's 5-field cron + flat steps. Org-scoped via
 * `requireServerNode` (generic not-found). Index-only (createServerFn exports).
 */

function toDaemonStep(step: ScheduleStep): DaemonScheduleStep {
	switch (step.kind) {
		case "command":
			return { type: "command", command: step.command };
		case "wait":
			return { type: "wait", seconds: step.seconds };
		case "power":
			return { type: "power", power: step.action };
		default:
			// backup isn't offered yet; the daemon would reject it anyway.
			return { type: "backup" };
	}
}

function toPanelStep(step: DaemonScheduleStep, index: number): ScheduleStep {
	const id = `step-${index}`;
	switch (step.type) {
		case "command":
			return { id, kind: "command", command: step.command ?? "" };
		case "wait":
			return { id, kind: "wait", seconds: step.seconds ?? 1 };
		case "power":
			return {
				id,
				kind: "power",
				action: (step.power as PowerAction) ?? "restart",
			};
		default:
			return { id, kind: "backup" };
	}
}

function toSchedule(d: DaemonSchedule): Schedule {
	const trigger = cronToTrigger(d.cron);
	const ran = d.lastStatus === "ok" || d.lastStatus === "error";
	return {
		id: d.id,
		serverId: d.serverId,
		name: d.name,
		frequency: trigger.frequency,
		time: trigger.time,
		dayOfWeek: trigger.dayOfWeek,
		enabled: d.enabled,
		lastRun: ran && d.lastRunAt ? formatRelativeTime(d.lastRunAt) : null,
		lastStatus: ran ? (d.lastStatus as "ok" | "error") : null,
		lastError: d.lastError ?? null,
		nextRun: d.enabled ? computeNextRun(trigger) : "Paused",
		steps: d.steps.map(toPanelStep),
	};
}

const stepSchema = z.discriminatedUnion("kind", [
	z.object({
		id: z.string(),
		kind: z.literal("command"),
		command: z.string().max(2000),
	}),
	z.object({
		id: z.string(),
		kind: z.literal("wait"),
		seconds: z.number().int().min(1).max(86_400),
	}),
	z.object({
		id: z.string(),
		kind: z.literal("power"),
		action: z.enum(["start", "stop", "restart"]),
	}),
	// Accepted at the type level (matches ScheduleStep), but the daemon rejects
	// backup steps until the backups slice — so they never actually persist.
	z.object({ id: z.string(), kind: z.literal("backup") }),
]);

export const listServerSchedules = createServerFn({ method: "GET" })
	.validator(z.object({ serverId: z.uuid() }))
	.handler(async ({ data }): Promise<DaemonRead<Schedule[]>> => {
		const { nodeId } = await requireServerNode(data.serverId);
		try {
			const all = await getNodeSchedules(nodeId);
			return {
				ok: true,
				data: all.filter((s) => s.serverId === data.serverId).map(toSchedule),
			};
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof DaemonError
						? error.message
						: "Could not reach the node",
			};
		}
	});

export const upsertSchedule = createServerFn({ method: "POST" })
	.validator(
		z.object({
			serverId: z.uuid(),
			// Present = edit an existing schedule; absent = create.
			id: z.string().max(64).optional(),
			name: z.string().trim().min(1).max(100),
			frequency: z.enum(["hourly", "daily", "weekly"]),
			time: z.string().regex(/^\d{2}:\d{2}$/),
			dayOfWeek: z.number().int().min(0).max(6),
			enabled: z.boolean().default(true),
			steps: z.array(stepSchema).min(1).max(25),
		})
	)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		const daemon: DaemonSchedule = {
			id: data.id ?? randomUUID(),
			serverId: data.serverId,
			name: data.name,
			cron: frequencyToCron(data),
			steps: data.steps.map(toDaemonStep),
			enabled: data.enabled,
		};
		return toSchedule(await upsertNodeSchedule(nodeId, daemon));
	});

export const deleteSchedule = createServerFn({ method: "POST" })
	.validator(z.object({ serverId: z.uuid(), id: z.string().max(64) }))
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await deleteNodeSchedule(nodeId, data.id);
		return { id: data.id };
	});

export const runScheduleNow = createServerFn({ method: "POST" })
	.validator(z.object({ serverId: z.uuid(), id: z.string().max(64) }))
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerNode(data.serverId);
		await runNodeSchedule(nodeId, data.id);
		return { ok: true as const };
	});
