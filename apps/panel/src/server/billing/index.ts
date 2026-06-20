import { createServerFn } from "@tanstack/react-start";
import type {
	BillingState,
	BillingStatus,
	CardBrand,
} from "@/lib/domain/billing";
import {
	FREE_NODE_GRANT,
	NODE_ENTITLEMENT,
	NODE_PRICE_CENTS,
	NodeBillingError,
} from "@/lib/domain/billing";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/server/auth/guards";
import { env } from "@/server/env";
import { nodesRepository } from "@/server/nodes/repository";
import {
	billingConfigured,
	createNodeCheckoutUrl,
	createPortalUrl,
	setSubscriptionCancel,
	updateSubscriptionSeats,
} from "./polar";
import { billingRepository } from "./repository";

/**
 * Billing service + server functions — the typed boundary the settings page
 * calls, and the gate + seat-sync the nodes layer calls. SDK calls live in
 * ./polar; the Polar→cache mapping lives in ./reconcile (run from webhooks);
 * this file is the read projection, the panel-side seat math, and the
 * `auth + validate + delegate` server fns.
 *
 * Billing is **org-scoped**: every server fn establishes the org via
 * `requireOrg`, and the mutating ones additionally require an owner/admin (the
 * "billing manager"). Reads are client-safe — no Polar ids, no card tokens.
 */

// --- Role gate -------------------------------------------------------------

/** The active org plus a check that the caller may manage billing. owner/admin
 * hold it; Polar would reject a plain member anyway, but we fail closed here. */
async function requireBillingManager() {
	const ctx = await requireOrg();
	const role = ctx.role ?? "";
	if (!(role.includes("owner") || role.includes("admin"))) {
		throw new Error("Forbidden");
	}
	return ctx;
}

// --- Seat math (the first-node-free decision point) ------------------------

/**
 * How many nodes the org pays for right now — the seat count pushed to Polar.
 * The first node is free during its 30-day grant, so it's excluded from the
 * count while the window is open; afterward every node is billable. This is the
 * single place the "first node free" rule shapes what Polar charges; adjust here
 * (or switch to a Polar-native trial) if the policy changes.
 */
async function requiredSeats(orgId: string): Promise<number> {
	const nodeCount = await nodesRepository.count(orgId);
	const entitlement = await billingRepository.getEntitlement(
		orgId,
		NODE_ENTITLEMENT
	);
	const withinFreeWindow =
		!!entitlement?.trialEndsAt &&
		entitlement.trialEndsAt.getTime() > Date.now();
	const freeNodes = withinFreeWindow ? FREE_NODE_GRANT : 0;
	return Math.max(0, nodeCount - freeNodes);
}

/** Start the 30-day free-first-node grant the first time an org gets a node. */
async function ensureNodeTrial(orgId: string): Promise<void> {
	const entitlement = await billingRepository.getEntitlement(
		orgId,
		NODE_ENTITLEMENT
	);
	if (entitlement) {
		return;
	}
	await billingRepository.upsertEntitlement(orgId, NODE_ENTITLEMENT, {
		status: "trialing",
		trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
	});
}

// --- Called by the nodes layer ---------------------------------------------

/**
 * Keep billing in step with the org's node count — called after a node is
 * created or removed. Opens the free-grant window on the first node, then syncs
 * the paid seat count onto the org's subscription. A no-op until billing is
 * configured, and when there's no paid subscription yet (the checkout flow
 * creates that). The new node itself is gated separately by `assertCanAddNode`.
 */
export async function syncNodeBilling(orgId: string): Promise<void> {
	if (!billingConfigured()) {
		return;
	}
	await ensureNodeTrial(orgId);
	const entitlement = await billingRepository.getEntitlement(
		orgId,
		NODE_ENTITLEMENT
	);
	if (!entitlement?.polarSubscriptionId) {
		return;
	}
	const seats = await requiredSeats(orgId);
	if (seats > 0) {
		await updateSubscriptionSeats(entitlement.polarSubscriptionId, seats);
	}
}

/** Whether a node entitlement currently lets the org add billable usage. */
function allowsNewUsage(status: string | undefined): boolean {
	return status === "active" || status === "trialing";
}

/**
 * Gate node creation on the org's node entitlement. The first node is always
 * free to add — its 30-day grant begins here — so the gate only bites from the
 * second node on, where an active/trialing subscription is required. Throws a
 * `NodeBillingError` (a friendly, user-facing message) when the org isn't
 * entitled; callers surface it as-is. A no-op until billing is configured.
 */
export async function assertCanAddNode(orgId: string): Promise<void> {
	if (!billingConfigured()) {
		return;
	}
	const current = await nodesRepository.count(orgId);
	// The first node is free for its first 30 days — never block it.
	if (current < FREE_NODE_GRANT) {
		return;
	}
	const entitlement = await billingRepository.getEntitlement(
		orgId,
		NODE_ENTITLEMENT
	);
	if (!allowsNewUsage(entitlement?.status)) {
		throw new NodeBillingError(
			"Add a payment method to run more than one node."
		);
	}
}

// --- Read projection -------------------------------------------------------

/** Project the org's cached billing rows to the client-safe `BillingState` the
 * settings page renders. Dates are pre-formatted (the UI's contract); secrets
 * (Polar ids, card tokens) never appear. */
async function getOrgBilling(orgId: string): Promise<BillingState> {
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

// --- Server functions ------------------------------------------------------

/** The active org's billing snapshot. Any member may read it. */
export const getBilling = createServerFn({ method: "GET" }).handler(
	async () => {
		const { orgId } = await requireOrg();
		return getOrgBilling(orgId);
	}
);

/** A hosted Polar checkout URL for the node subscription. Records the caller as
 * the billing contact and seats the checkout at the current billable count. */
export const startNodeCheckout = createServerFn({ method: "POST" }).handler(
	async () => {
		const { orgId, userId } = await requireBillingManager();
		await billingRepository.upsertCustomer(orgId, {
			billingContactUserId: userId,
		});
		const seats = await requiredSeats(orgId);
		const url = await createNodeCheckoutUrl({
			orgId,
			seats,
			successUrl: `${env.AUTH_URL}/settings/billing`,
		});
		return { url };
	}
);

/** A hosted Polar customer-portal URL (manage card, invoices, cancellation). */
export const openBillingPortal = createServerFn({ method: "POST" }).handler(
	async () => {
		const { orgId } = await requireBillingManager();
		const url = await createPortalUrl(orgId);
		return { url };
	}
);

/** Cancel the node plan at period end; access holds until the period closes. */
export const cancelNodePlan = createServerFn({ method: "POST" }).handler(
	async () => {
		const { orgId } = await requireBillingManager();
		const entitlement = await billingRepository.getEntitlement(
			orgId,
			NODE_ENTITLEMENT
		);
		// No paid subscription yet (still in the free trial) — nothing to cancel;
		// the trial simply lapses. Treat as success so the UI stays simple.
		if (!entitlement?.polarSubscriptionId) {
			return { ok: true };
		}
		await setSubscriptionCancel(entitlement.polarSubscriptionId, true);
		// Reflect immediately; the webhook confirms it shortly after.
		await billingRepository.upsertEntitlement(orgId, NODE_ENTITLEMENT, {
			cancelAtPeriodEnd: true,
		});
		return { ok: true };
	}
);

/** Undo a pending cancellation. */
export const resumeNodePlan = createServerFn({ method: "POST" }).handler(
	async () => {
		const { orgId } = await requireBillingManager();
		const entitlement = await billingRepository.getEntitlement(
			orgId,
			NODE_ENTITLEMENT
		);
		if (!entitlement?.polarSubscriptionId) {
			return { ok: true };
		}
		await setSubscriptionCancel(entitlement.polarSubscriptionId, false);
		await billingRepository.upsertEntitlement(orgId, NODE_ENTITLEMENT, {
			cancelAtPeriodEnd: false,
		});
		return { ok: true };
	}
);
