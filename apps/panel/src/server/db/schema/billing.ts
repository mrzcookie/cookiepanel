import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";

/**
 * Billing cache — panel-owned mirror of Polar (the source of truth). Polar's
 * webhooks reconcile these rows; the panel reads them to gate actions and render
 * the billing surface without a round-trip per request. Nothing secret lives here
 * (no card tokens, no Polar API keys) — only ids, status, and display fields.
 *
 * Two tables, split on grain:
 *  - `billingCustomer` is customer-wide (one per org): the Polar customer link,
 *    who funds it, and the display-only funding card.
 *  - `orgEntitlement` is per *purchasable thing* (one row per org + key): the
 *    node subscription today, future addons as new keys. Keeping entitlements
 *    keyed — rather than baking node fields onto a single billing row — is what
 *    lets an addon land as another row, not a schema change. See
 *    `lib/domain/billing.ts` for the key set.
 */

/**
 * One row per org: its Polar customer (`external_id = orgId` on Polar's side),
 * the user funding the plan, and the card on file as display-only fields. The
 * card columns mirror Polar's payment method — brand + last four only, never a
 * full number or token; the hosted portal owns anything sensitive.
 */
export const billingCustomer = pgTable("billing_customer", {
	// One customer per org — the org id is the natural key.
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	// Polar's customer id; null until the customer is created (lazily, at first
	// checkout or org creation).
	polarCustomerId: text("polar_customer_id"),
	// The person funding the org's plan (org-scoped billing, user-paid). Kept on
	// user deletion (set null) so the org's billing link survives.
	billingContactUserId: text("billing_contact_user_id").references(
		() => user.id,
		{ onDelete: "set null" }
	),
	// Display-only funding card; null when none is on file.
	cardBrand: text("card_brand"),
	cardLast4: text("card_last4"),
	cardExpMonth: integer("card_exp_month"),
	cardExpYear: integer("card_exp_year"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at")
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
});

/**
 * One row per (org, entitlement key) — what the org is entitled to and the
 * lifecycle of the subscription backing it. `key` is the addon dimension
 * (`"nodes"` today); `quantity` is the seat/node count for a metered entitlement
 * or 0/1 for a boolean addon. Status, period, and cancellation are per-entitlement
 * because each maps to its own Polar subscription with its own renewal.
 */
export const orgEntitlement = pgTable(
	"org_entitlement",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Entitlement key — see `ENTITLEMENT_KEYS` in lib/domain/billing.ts.
		key: text("key").notNull(),
		// Billing lifecycle for this entitlement: none / trialing / active /
		// past_due / canceled (mirrors `BillingStatus`).
		status: text("status").notNull().default("none"),
		// Seat/node count for a metered entitlement; 0/1 for a boolean addon.
		quantity: integer("quantity").notNull().default(0),
		// The Polar subscription/product backing this entitlement, when one exists.
		polarSubscriptionId: text("polar_subscription_id"),
		polarProductId: text("polar_product_id"),
		// Cached per-unit price (cents) for display, mirrored from Polar.
		unitPriceCents: integer("unit_price_cents"),
		// Next renewal, or — once canceled — the day access ends.
		currentPeriodEnd: timestamp("current_period_end"),
		cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
		// When the free-grant trial ends (set only while trialing).
		trialEndsAt: timestamp("trial_ends_at"),
		// When the dunning grace window closes (set only while past_due).
		graceEndsAt: timestamp("grace_ends_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		// One entitlement per key per org — the upsert target.
		unique("org_entitlement_org_key_uq").on(table.organizationId, table.key),
		index("org_entitlement_org_idx").on(table.organizationId),
	]
);
