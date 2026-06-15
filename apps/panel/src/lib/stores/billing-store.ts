import type { BillingState, PaymentMethod } from "@/lib/domain/billing";
import { NODE_PRICE_CENTS } from "@/lib/domain/billing";
import { createStore } from "@/lib/store";
import { CURRENT_USER } from "@/lib/stubs";

// Mutable client-side stub for per-org billing — the stand-in for the Polar +
// data-layer integration. Keyed by org id, so the active org's plan, node count,
// payment method, and invoices switch with the org switcher. The seeds cover the
// whole lifecycle (one org per state) so every surface is reachable in the UI.
//
// Actions here simulate the round-trip to Polar's hosted checkout/portal (and the
// webhooks that follow): the real version redirects the browser to Polar and
// reconciles status from `customer.state_changed`. Replaced wholesale when the
// server layer + `@polar-sh/better-auth` land. No secrets live here.

// Org ids (mirrors lib/stores/orgs-store).
const ORG = {
	acme: "7c9e6a52-3f1b-4d8a-9e2c-1a4b6d8f0e21",
	northwind: "b3d8f1a4-6c2e-4a90-8b15-7e0c3d9f2a64",
	pixelforge: "c4e9a2b5-7d3f-4b01-9c26-8f1d4e0a3b75",
	lonePine: "d5f0b3c6-8e4a-4c12-8d37-9a2e5f1b4c86",
} as const;

const CONTACT = { name: CURRENT_USER.name, email: CURRENT_USER.email };

// A brand-new / unbilled org: no plan, no nodes. Shared frozen reference so the
// `useBilling` selector keeps a stable identity for orgs without a seed (e.g. an
// org created at runtime) and never churns renders. Exported so cross-org views
// (admin billing) can fall back to it for an org with no billing record yet.
export const EMPTY_STATE: BillingState = {
	status: "none",
	nodeCount: 0,
	pricePerNodeCents: NODE_PRICE_CENTS,
	trialEndsAt: null,
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
	graceEndsAt: null,
	paymentMethod: null,
	invoices: [],
	billingContact: null,
};

const SEED: Record<string, BillingState> = {
	// Active, healthy: a full fleet on a card, renewing next month.
	[ORG.acme]: {
		status: "active",
		nodeCount: 6,
		pricePerNodeCents: NODE_PRICE_CENTS,
		trialEndsAt: null,
		currentPeriodEnd: "Jul 11, 2026",
		cancelAtPeriodEnd: false,
		graceEndsAt: null,
		paymentMethod: {
			brand: "Visa",
			last4: "4242",
			expMonth: 11,
			expYear: 2028,
		},
		invoices: [
			{
				id: "1c0ffee0-0001-4a00-8a00-000000000007",
				number: "CKP-0007",
				date: "Jun 11, 2026",
				amountCents: 6000,
				status: "paid",
			},
			{
				id: "1c0ffee0-0002-4a00-8a00-000000000006",
				number: "CKP-0006",
				date: "May 11, 2026",
				amountCents: 6000,
				status: "paid",
			},
			{
				id: "1c0ffee0-0003-4a00-8a00-000000000005",
				number: "CKP-0005",
				date: "Apr 11, 2026",
				amountCents: 5000,
				status: "paid",
			},
		],
		billingContact: CONTACT,
	},
	// Trialing: just their first node, free for 30 days, no card yet — the nudge to
	// add one before the trial converts.
	[ORG.northwind]: {
		status: "trialing",
		nodeCount: 1,
		pricePerNodeCents: NODE_PRICE_CENTS,
		trialEndsAt: "Jul 07, 2026",
		currentPeriodEnd: null,
		cancelAtPeriodEnd: false,
		graceEndsAt: null,
		paymentMethod: null,
		invoices: [],
		billingContact: CONTACT,
	},
	// Past due: a charge failed and the grace window is counting down. Drives the
	// app-wide banner.
	[ORG.pixelforge]: {
		status: "past_due",
		nodeCount: 3,
		pricePerNodeCents: NODE_PRICE_CENTS,
		trialEndsAt: null,
		currentPeriodEnd: "Jun 12, 2026",
		cancelAtPeriodEnd: false,
		graceEndsAt: "Jun 26, 2026",
		paymentMethod: { brand: "Visa", last4: "0119", expMonth: 4, expYear: 2026 },
		invoices: [
			{
				id: "2dec0de0-0001-4b00-8b00-000000000031",
				number: "CKP-0031",
				date: "Jun 12, 2026",
				amountCents: 3000,
				status: "open",
			},
			{
				id: "2dec0de0-0002-4b00-8b00-000000000030",
				number: "CKP-0030",
				date: "May 12, 2026",
				amountCents: 3000,
				status: "paid",
			},
		],
		billingContact: CONTACT,
	},
	// No plan: a fresh org with no nodes. The first node is free for 30 days, so
	// billing starts by connecting one — not by buying anything.
	[ORG.lonePine]: EMPTY_STATE,
};

const store = createStore<Record<string, BillingState>>(SEED);

/** An org's billing (unknown orgs read as no plan). Reads the whole snapshot and
 * indexes by `orgId` so the value tracks the *active org* changing — not just the
 * billing store mutating (a parameterized `useWith` selector would cache against
 * the snapshot identity and miss an org switch). */
export function useBilling(orgId: string): BillingState {
	return store.use()[orgId] ?? EMPTY_STATE;
}

/** Every org's billing, keyed by org id — the platform-wide (admin) view. The
 * caller joins it with the org list and falls back to EMPTY_STATE per org. */
export function useAllBilling(): Record<string, BillingState> {
	return store.use();
}

function patch(orgId: string, changes: Partial<BillingState>) {
	const all = store.get();
	const current = all[orgId] ?? EMPTY_STATE;
	store.set({ ...all, [orgId]: { ...current, ...changes } });
}

// A card the simulated Polar checkout/portal "returns" with. Real billing never
// sees card data — Polar's hosted, PCI-scoped surfaces own it.
const RETURNED_CARD: PaymentMethod = {
	brand: "Visa",
	last4: "4242",
	expMonth: 12,
	expYear: 2029,
};

/** Attach (or replace) the card on file — what a return from Polar checkout looks
 * like. Defaults to the simulated card. */
export function attachPaymentMethod(orgId: string, card = RETURNED_CARD) {
	patch(orgId, { paymentMethod: card });
}

/** Recover from a failed payment: a fresh card clears the grace window and the
 * subscription goes active again (in reality, driven by `order.paid`). */
export function recoverFromPastDue(orgId: string, card = RETURNED_CARD) {
	patch(orgId, { status: "active", graceEndsAt: null, paymentMethod: card });
}

/** Cancel at period end — access holds until `currentPeriodEnd`. */
export function cancelSubscription(orgId: string) {
	patch(orgId, { status: "canceled", cancelAtPeriodEnd: true });
}

/** Undo a pending cancellation. */
export function resumeSubscription(orgId: string) {
	patch(orgId, { status: "active", cancelAtPeriodEnd: false });
}
