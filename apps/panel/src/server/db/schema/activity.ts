import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * Activity log — the audit trail (who / which org / category / action / target /
 * IP). Append-only. `organizationId` is null for account-level events (e.g. a
 * login before an org is active); `userId` is null for system actions and is set
 * null (not cascaded) on user deletion so the trail survives, while `actorName`
 * is denormalized so an entry still reads after the user is gone.
 */
export const activityLog = pgTable(
	"activity_log",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id").references(() => organization.id, {
			onDelete: "cascade",
		}),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		actorName: text("actor_name"),
		category: text("category").notNull(),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		targetLabel: text("target_label"),
		ip: text("ip"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		// Org feed and account feed, both newest-first.
		index("activity_log_org_created_idx").on(
			table.organizationId,
			table.createdAt
		),
		index("activity_log_user_created_idx").on(table.userId, table.createdAt),
	]
);
