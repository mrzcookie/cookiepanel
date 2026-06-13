import { useSyncExternalStore } from "react";
import {
	computeNextRun,
	type Schedule,
	type ScheduleInput,
} from "@/lib/schedules";
import { SERVERS } from "@/lib/stubs";

// Mutable client-side stub store for server schedules. Seeded with a couple of
// automations per server (deterministic ids so SSR and the first client render
// agree); the wizard creates new ones with crypto ids. Replaced when the daemon
// scheduler lands. Mutations are browser-only.

function seed(): Schedule[] {
	const out: Schedule[] = [];
	for (const server of SERVERS) {
		out.push(
			{
				id: `${server.id}-sch-1`,
				serverId: server.id,
				name: "Nightly restart",
				frequency: "daily",
				time: "04:00",
				dayOfWeek: 0,
				enabled: true,
				lastRun: "Today at 04:00",
				nextRun: "Tomorrow at 04:00",
				steps: [
					{
						id: `${server.id}-sch-1-s1`,
						kind: "command",
						command: "say Server restarting in 60 seconds",
					},
					{ id: `${server.id}-sch-1-s2`, kind: "wait", seconds: 60 },
					{ id: `${server.id}-sch-1-s3`, kind: "power", action: "restart" },
				],
			},
			{
				id: `${server.id}-sch-2`,
				serverId: server.id,
				name: "Weekly backup",
				frequency: "weekly",
				time: "03:00",
				dayOfWeek: 0,
				enabled: false,
				lastRun: null,
				nextRun: "Next Sunday at 03:00",
				steps: [{ id: `${server.id}-sch-2-s1`, kind: "backup" }],
			}
		);
	}
	return out;
}

let schedules: Schedule[] = seed();
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function getSnapshot() {
	return schedules;
}

export function useServerSchedules(serverId: string): Schedule[] {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).filter(
		(schedule) => schedule.serverId === serverId
	);
}

export function createSchedule(
	serverId: string,
	input: ScheduleInput
): Schedule {
	const schedule: Schedule = {
		id: crypto.randomUUID(),
		serverId,
		name: input.name.trim(),
		frequency: input.frequency,
		time: input.time,
		dayOfWeek: input.dayOfWeek,
		enabled: true,
		lastRun: null,
		nextRun: computeNextRun(input),
		steps: input.steps,
	};
	schedules = [schedule, ...schedules];
	emit();
	return schedule;
}

export function toggleSchedule(id: string) {
	schedules = schedules.map((schedule) =>
		schedule.id === id ? { ...schedule, enabled: !schedule.enabled } : schedule
	);
	emit();
}

export function runSchedule(id: string) {
	schedules = schedules.map((schedule) =>
		schedule.id === id ? { ...schedule, lastRun: "Just now" } : schedule
	);
	emit();
}

export function deleteSchedule(id: string) {
	schedules = schedules.filter((schedule) => schedule.id !== id);
	emit();
}
