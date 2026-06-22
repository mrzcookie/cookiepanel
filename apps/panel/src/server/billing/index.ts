import { createServerFn } from "@tanstack/react-start";
import { NODE_ENTITLEMENT } from "@/lib/domain/billing";
import { requireOrg } from "@/server/auth/guards";
import { env } from "@/server/env";
import { requiredSeats } from "./node-sync";
import {
	createNodeCheckoutUrl,
	createPortalUrl,
	setSubscriptionCancel,
} from "./polar";
import { projectOrgBilling } from "./projection";
import { billingRepository } from "./repository";

/**
 * Billing **server functions** — the typed boundary the settings page calls:
 * the read projection + the `auth + validate + delegate` checkout/portal/cancel
 * fns. SDK calls live in ./polar; the Polar→cache mapping in ./reconcile (run
 * from webhooks); the node-create gate + seat sync the nodes layer calls live in
 * ./node-sync.
 *
 * This file MUST export only `createServerFn`s. The client imports them via
 * `lib/billing-queries.ts`, and the bundler can only strip the server-only
 * internals (db, Polar SDK, env) from the browser build when nothing else is
 * exported — see the note in ./node-sync.
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

// --- Server functions ------------------------------------------------------

/** The active org's billing snapshot. Any member may read it. */
export const getBilling = createServerFn({ method: "GET" }).handler(
	async () => {
		const { orgId } = await requireOrg();
		return projectOrgBilling(orgId);
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
