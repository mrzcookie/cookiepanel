import {
	computeNextRun,
	type Schedule,
	type ScheduleInput,
} from "@/lib/domain/schedules";
import { createStore } from "@/lib/store";
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

const store = createStore<Schedule[]>(seed());

export function useServerSchedules(serverId: string): Schedule[] {
	return store.use().filter((schedule) => schedule.serverId === serverId);
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
	store.set([schedule, ...store.get()]);
	return schedule;
}

export function toggleSchedule(id: string) {
	store.set(
		store
			.get()
			.map((schedule) =>
				schedule.id === id
					? { ...schedule, enabled: !schedule.enabled }
					: schedule
			)
	);
}

export function runSchedule(id: string) {
	store.set(
		store
			.get()
			.map((schedule) =>
				schedule.id === id ? { ...schedule, lastRun: "Just now" } : schedule
			)
	);
}

export function deleteSchedule(id: string) {
	store.set(store.get().filter((schedule) => schedule.id !== id));
}
