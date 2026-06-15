// Billing domain types (client-safe) + the pure cost math. Billing is scoped to
// the organization — the org owns the nodes and the subscription — while a person
// (the billing contact) funds it with a card managed in Polar's hosted portal.
//
// The provider is Polar: one per-org seat subscription where the seat count is the
// org's node count, at a flat per-node monthly price. The "first node free for 30
// days" grant is computed here, not in Polar (a native trial would free the whole
// subscription). Everything here is client-safe — no Polar customer ids, no card
// tokens, no secrets; the hosted portal/checkout own anything sensitive.

export type BillingStatus =
	| "none" // no subscription yet (no nodes, or never started)
	| "trialing" // inside the 30-day free-first-node grant
	| "active" // paid and healthy
	| "past_due" // a charge failed; inside the dunning grace window
	| "canceled"; // set to end at period close (access holds until then)

export type CardBrand = "Visa" | "Mastercard" | "Amex" | "Discover";

/** The card funding the org's plan. A display projection of Polar's payment
 * method — last four only, never a full number or token. */
export type PaymentMethod = {
	brand: CardBrand;
	last4: string;
	expMonth: number;
	expYear: number;
};

export type InvoiceStatus = "paid" | "open" | "void";

export type Invoice = {
	id: string;
	/** Human invoice number, e.g. "CKP-0007". */
	number: string;
	/** Pre-formatted issue date for the UI-first phase. */
	date: string;
	amountCents: number;
	status: InvoiceStatus;
};

export type BillingState = {
	status: BillingStatus;
	/** Billable boxes the org runs. When the data layer lands this is derived by
	 * counting the org's real nodes; the seat count on Polar is kept in sync. */
	nodeCount: number;
	/** Per-node monthly price, in cents (mirrors Polar; cents avoid float drift). */
	pricePerNodeCents: number;
	/** When the free-first-node grant ends. Set only while `trialing`. */
	trialEndsAt: string | null;
	/** Next renewal date, or — once canceled — the day access ends. */
	currentPeriodEnd: string | null;
	/** Canceled but still active until the period closes. */
	cancelAtPeriodEnd: boolean;
	/** When `past_due`, the day the grace window closes and nodes are suspended. */
	graceEndsAt: string | null;
	/** The card on file, or null if none yet. */
	paymentMethod: PaymentMethod | null;
	invoices: Invoice[];
	/** The person funding the org's plan (org-scoped billing, user-paid). */
	billingContact: { name: string; email: string } | null;
};

/** The first node is free for its first 30 days — exactly one node per org. */
export const FREE_NODE_GRANT = 1;

/** Default per-node price: $10/month. */
export const NODE_PRICE_CENTS = 1000;

/** How many of the org's nodes are currently free (the trial grant, capped at the
 * node count). Zero once the grant has ended. */
export function freeNodeCount(state: BillingState): number {
	return state.status === "trialing"
		? Math.min(FREE_NODE_GRANT, state.nodeCount)
		: 0;
}

/** Nodes the org actually pays for right now. */
export function billableNodeCount(state: BillingState): number {
	return Math.max(0, state.nodeCount - freeNodeCount(state));
}

/** What the org is billed this month, in cents (free nodes excluded). */
export function monthlyTotalCents(state: BillingState): number {
	return billableNodeCount(state) * state.pricePerNodeCents;
}

/** What the org will be billed once the free grant ends — every node counts. */
export function projectedMonthlyCents(state: BillingState): number {
	return state.nodeCount * state.pricePerNodeCents;
}
