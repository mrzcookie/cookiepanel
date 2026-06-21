import {
	FREE_NODE_GRANT,
	NODE_ENTITLEMENT,
	NodeBillingError,
} from "@/lib/domain/billing";
import { nodesRepository } from "@/server/nodes/repository";
import { billingConfigured, updateSubscriptionSeats } from "./polar";
import { billingRepository } from "./repository";

/**
 * The billing helpers the **nodes layer** calls — the node-create gate and the
 * seat sync — plus the seat math they share with the checkout server fn.
 *
 * These live here, apart from `./index.ts`, on purpose: they are plain
 * server-only functions (not `createServerFn`), and `@/server/nodes` imports
 * them. If they sat in `index.ts` alongside the server fns, the client build —
 * which imports those server fns via `lib/billing-queries.ts` — could not strip
 * them, so their `@/server/db` / Polar-SDK / env imports would be bundled into
 * the browser and throw at load (t3-env blocks server vars on the client),
 * breaking hydration app-wide. Keeping `index.ts` to *only* `createServerFn`
 * exports is what lets the bundler tree-shake all of this out of the client.
 */

/**
 * How many nodes the org pays for right now — the seat count pushed to Polar.
 * The first node is free during its 30-day grant, so it's excluded from the
 * count while the window is open; afterward every node is billable. This is the
 * single place the "first node free" rule shapes what Polar charges; adjust here
 * (or switch to a Polar-native trial) if the policy changes.
 */
export async function requiredSeats(orgId: string): Promise<number> {
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
