import type { Subscription } from "@polar-sh/sdk/models/components/subscription.js";
import type { BillingStatus } from "@/lib/domain/billing";
import { NODE_ENTITLEMENT } from "@/lib/domain/billing";
import { billingRepository } from "./repository";

/**
 * Maps Polar → the billing cache. Polar is the source of truth; these writers
 * run from the webhook handlers (server/auth) so the panel's `org_entitlement` /
 * `billing_customer` rows converge on whatever Polar last reported. Idempotent
 * (the repository upserts), since Polar may redeliver an event.
 *
 * Everything keys off the subscription's `customer.externalId`, which we set to
 * the org id at checkout (see ./polar.ts). A payload without one isn't ours —
 * skip it rather than guess.
 */

/** Polar subscription status → our `BillingStatus`. The pre-active states
 * (`incomplete*`) and `unpaid` collapse to the nearest meaningful UI state. */
function toBillingStatus(status: string): BillingStatus {
	switch (status) {
		case "active":
			return "active";
		case "trialing":
			return "trialing";
		case "past_due":
			return "past_due";
		case "canceled":
		case "unpaid":
			return "canceled";
		default:
			// incomplete / incomplete_expired — no usable entitlement yet.
			return "none";
	}
}

/**
 * Upsert the org's customer + node entitlement from a Polar subscription event
 * (`subscription.created/updated/active/canceled/...`). Carries the full status
 * — including `past_due`/`canceled`, which the customer-state snapshot omits —
 * so it's the primary reconcile path.
 */
export async function reconcileFromSubscription(
	sub: Subscription
): Promise<void> {
	const orgId = sub.customer?.externalId;
	if (!orgId) {
		return;
	}

	await billingRepository.upsertCustomer(orgId, {
		polarCustomerId: sub.customerId,
	});

	const status = toBillingStatus(sub.status);
	await billingRepository.upsertEntitlement(orgId, NODE_ENTITLEMENT, {
		status,
		quantity: sub.seats ?? 0,
		polarSubscriptionId: sub.id,
		polarProductId: sub.productId,
		currentPeriodEnd: sub.currentPeriodEnd ?? null,
		cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
		// Polar drives dunning; surface the period end as the grace deadline so the
		// past-due banner has a date to count down to.
		graceEndsAt: status === "past_due" ? (sub.currentPeriodEnd ?? null) : null,
	});
}
