import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { EntitlementKey } from "@/lib/domain/billing";
import { db } from "@/server/db";
import { user } from "@/server/db/schema/auth";
import { billingCustomer, orgEntitlement } from "@/server/db/schema/billing";

export type BillingCustomerRecord = typeof billingCustomer.$inferSelect;
export type EntitlementRecord = typeof orgEntitlement.$inferSelect;

type CustomerValues = Partial<
	Omit<typeof billingCustomer.$inferInsert, "organizationId">
>;
type EntitlementValues = Partial<
	Omit<
		typeof orgEntitlement.$inferInsert,
		"id" | "organizationId" | "key" | "createdAt"
	>
>;

/**
 * The only module that touches the billing cache (`billing_customer`,
 * `org_entitlement`). Every method is **org-scoped** — `organizationId` is ANDed
 * into every predicate — so a row in another org is indistinguishable from a
 * missing one (the IDOR backstop from security.md). Writes are upserts because
 * the rows are a cache Polar's webhooks reconcile, not user-authored records:
 * the same event may arrive more than once, and the row may or may not exist yet.
 */
export const billingRepository = {
	/** The funding user's display name + email, for the billing-contact readout.
	 * A plain user read (no org scope) — the caller has already resolved the
	 * contact id from the org's own customer row. */
	getContact: (
		userId: string
	): Promise<{ name: string; email: string } | null> =>
		db
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
			.then((rows) => rows.at(0) ?? null),

	getCustomer: (orgId: string): Promise<BillingCustomerRecord | undefined> =>
		db
			.select()
			.from(billingCustomer)
			.where(eq(billingCustomer.organizationId, orgId))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** Create or update the org's customer row (idempotent on the org id). */
	upsertCustomer: async (
		orgId: string,
		values: CustomerValues
	): Promise<BillingCustomerRecord> => {
		const [row] = await db
			.insert(billingCustomer)
			.values({ ...values, organizationId: orgId })
			.onConflictDoUpdate({
				target: billingCustomer.organizationId,
				set: values,
			})
			.returning();
		if (!row) {
			throw new Error("Failed to upsert billing customer");
		}
		return row;
	},

	listEntitlements: (orgId: string): Promise<EntitlementRecord[]> =>
		db
			.select()
			.from(orgEntitlement)
			.where(eq(orgEntitlement.organizationId, orgId)),

	getEntitlement: (
		orgId: string,
		key: EntitlementKey
	): Promise<EntitlementRecord | undefined> =>
		db
			.select()
			.from(orgEntitlement)
			.where(
				and(
					eq(orgEntitlement.organizationId, orgId),
					eq(orgEntitlement.key, key)
				)
			)
			.limit(1)
			.then((rows) => rows.at(0)),

	/** Create or update an org's entitlement for a key (idempotent on org+key). */
	upsertEntitlement: async (
		orgId: string,
		key: EntitlementKey,
		values: EntitlementValues
	): Promise<EntitlementRecord> => {
		const [row] = await db
			.insert(orgEntitlement)
			.values({ ...values, id: randomUUID(), organizationId: orgId, key })
			.onConflictDoUpdate({
				target: [orgEntitlement.organizationId, orgEntitlement.key],
				set: values,
			})
			.returning();
		if (!row) {
			throw new Error("Failed to upsert entitlement");
		}
		return row;
	},
};
