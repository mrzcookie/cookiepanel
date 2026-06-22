import type {
	BillingState,
	BillingStatus,
	CardBrand,
} from "@/lib/domain/billing";
import { NODE_ENTITLEMENT, NODE_PRICE_CENTS } from "@/lib/domain/billing";
import { formatDate } from "@/lib/format";
import { nodesRepository } from "@/server/nodes/repository";
import { billingRepository } from "./repository";

/**
 * Project an org's cached billing rows to the client-safe `BillingState` the UI
 * renders — dates pre-formatted (the UI's contract), secrets (Polar ids, card
 * tokens) never included.
 *
 * Server-only (touches the DB). Shared by the org-scoped `getBilling` server fn
 * and the admin cross-org billing read, so it lives outside index.ts, which must
 * stay createServerFn-only for the client bundle to tree-shake the DB/Polar/env
 * internals out (see the note there).
 */
export async function projectOrgBilling(orgId: string): Promise<BillingState> {
	const [nodeCount, entitlement, customer] = await Promise.all([
		nodesRepository.count(orgId),
		billingRepository.getEntitlement(orgId, NODE_ENTITLEMENT),
		billingRepository.getCustomer(orgId),
	]);

	const contact = customer?.billingContactUserId
		? await billingRepository.getContact(customer.billingContactUserId)
		: null;

	const paymentMethod =
		customer?.cardBrand &&
		customer.cardLast4 &&
		customer.cardExpMonth &&
		customer.cardExpYear
			? {
					brand: customer.cardBrand as CardBrand,
					last4: customer.cardLast4,
					expMonth: customer.cardExpMonth,
					expYear: customer.cardExpYear,
				}
			: null;

	// An entitlement row's status when present; otherwise derive from node count
	// (an org with nodes but no row yet is inside its free window → trialing).
	const status: BillingStatus = entitlement
		? (entitlement.status as BillingStatus)
		: nodeCount > 0
			? "trialing"
			: "none";

	return {
		status,
		nodeCount,
		pricePerNodeCents: entitlement?.unitPriceCents ?? NODE_PRICE_CENTS,
		trialEndsAt: entitlement?.trialEndsAt
			? formatDate(entitlement.trialEndsAt)
			: null,
		currentPeriodEnd: entitlement?.currentPeriodEnd
			? formatDate(entitlement.currentPeriodEnd)
			: null,
		cancelAtPeriodEnd: entitlement?.cancelAtPeriodEnd ?? false,
		graceEndsAt: entitlement?.graceEndsAt
			? formatDate(entitlement.graceEndsAt)
			: null,
		paymentMethod,
		// Invoices come from Polar's orders API (deferred); the portal lists them
		// in the meantime.
		invoices: [],
		billingContact: contact,
	};
}
