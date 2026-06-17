import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/server/db";
import { activityLog } from "@/server/db/schema/activity";

export type ActivityRecord = typeof activityLog.$inferSelect;
export type NewActivityValues = typeof activityLog.$inferInsert;

/** Newest-first window. `before` is a keyset cursor on createdAt. */
export type ActivityPage = { limit: number; before?: Date };

const newestFirst = desc(activityLog.createdAt);

/**
 * The only module that touches `activity_log`. Reads are scoped by the caller:
 * `listForOrg` is org-scoped (settings feed), `listForUser` is user-scoped
 * (account feed), and `listAll` is unscoped — its server fn must be admin-gated.
 */
export const activityRepository = {
	insert: (values: NewActivityValues) => db.insert(activityLog).values(values),

	listForOrg: (orgId: string, page: ActivityPage) =>
		db
			.select()
			.from(activityLog)
			.where(
				and(
					eq(activityLog.organizationId, orgId),
					page.before ? lt(activityLog.createdAt, page.before) : undefined
				)
			)
			.orderBy(newestFirst)
			.limit(page.limit),

	listForUser: (userId: string, page: ActivityPage) =>
		db
			.select()
			.from(activityLog)
			.where(
				and(
					eq(activityLog.userId, userId),
					page.before ? lt(activityLog.createdAt, page.before) : undefined
				)
			)
			.orderBy(newestFirst)
			.limit(page.limit),

	listAll: (page: ActivityPage) =>
		db
			.select()
			.from(activityLog)
			.where(page.before ? lt(activityLog.createdAt, page.before) : undefined)
			.orderBy(newestFirst)
			.limit(page.limit),
};
