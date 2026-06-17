import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ActivityCategory, ActivityEntry } from "@/lib/domain/activity";
import { requireAdmin, requireOrg, requireSession } from "@/server/auth/guards";
import { type ActivityRecord, activityRepository } from "./repository";

/**
 * Activity-log read API — the typed boundary the UI calls (UI wiring left for
 * later). Three scoped feeds: the active org's (`listActivity`), the caller's
 * own (`listMyActivity`), and the whole platform (`listAllActivity`, admin
 * only). Writes go through `recordActivity` in ./record, not here.
 */

function toActivityEntry(record: ActivityRecord): ActivityEntry {
	return {
		id: record.id,
		category: record.category as ActivityCategory,
		action: record.action,
		actorId: record.userId,
		actor: record.actorName,
		target: record.targetLabel,
		targetType: record.targetType,
		targetId: record.targetId,
		ip: record.ip,
		createdAt: record.createdAt.toISOString(),
	};
}

const pageInput = z
	.object({
		limit: z.number().int().min(1).max(200).default(50),
		// Keyset cursor: ISO timestamp of the last row from the previous page.
		before: z.string().optional(),
	})
	.default({ limit: 50 });

function toPage(data: { limit: number; before?: string }) {
	return {
		limit: data.limit,
		before: data.before ? new Date(data.before) : undefined,
	};
}

export const listActivity = createServerFn({ method: "GET" })
	.validator(pageInput)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const rows = await activityRepository.listForOrg(orgId, toPage(data));
		return rows.map(toActivityEntry);
	});

export const listMyActivity = createServerFn({ method: "GET" })
	.validator(pageInput)
	.handler(async ({ data }) => {
		const session = await requireSession();
		const rows = await activityRepository.listForUser(
			session.user.id,
			toPage(data)
		);
		return rows.map(toActivityEntry);
	});

export const listAllActivity = createServerFn({ method: "GET" })
	.validator(pageInput)
	.handler(async ({ data }) => {
		await requireAdmin();
		const rows = await activityRepository.listAll(toPage(data));
		return rows.map(toActivityEntry);
	});
