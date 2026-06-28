import { randomUUID } from "node:crypto";
import type { ActivityCategory } from "@/lib/domain/activity";
import { log } from "@/server/log";
import { activityRepository } from "./repository";

export type RecordActivityInput = {
	category: ActivityCategory;
	/** Stable action key, e.g. "login", "node.created". */
	action: string;
	organizationId?: string | null;
	userId?: string | null;
	actorName?: string | null;
	targetType?: string | null;
	targetId?: string | null;
	targetLabel?: string | null;
	ip?: string | null;
	metadata?: Record<string, unknown>;
};

/**
 * Append an audit entry. **Best-effort**: audit logging must never break the
 * action it records, so a failure here is swallowed (and logged), not thrown.
 * Called by server services and the Better Auth lifecycle hooks; it imports the
 * repository only (no guards), so it stays free of the auth import cycle.
 */
export async function recordActivity(input: RecordActivityInput) {
	try {
		await activityRepository.insert({
			id: randomUUID(),
			category: input.category,
			action: input.action,
			organizationId: input.organizationId ?? null,
			userId: input.userId ?? null,
			actorName: input.actorName ?? null,
			targetType: input.targetType ?? null,
			targetId: input.targetId ?? null,
			targetLabel: input.targetLabel ?? null,
			ip: input.ip ?? null,
			metadata: input.metadata ?? null,
		});
	} catch (error) {
		log.error("activity: failed to record entry", { error });
	}
}
