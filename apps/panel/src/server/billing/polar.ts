import { Polar } from "@polar-sh/sdk";
import { env } from "@/server/env";

/**
 * The Polar SDK boundary — the only module that talks to Polar's API. Everything
 * else in `server/billing` calls these typed helpers, so the rest of the layer
 * never imports the SDK or knows about products/seats wire shapes.
 *
 * **Org-as-customer.** CookiePanel bills the *organization*, not the user, so we
 * drive checkout/portal/seats through the SDK with `externalCustomerId = orgId`
 * (Polar creates/links the customer on first checkout). That's why we use the
 * Better Auth Polar plugin for *webhooks only* (see server/auth) — its built-in
 * checkout/portal endpoints are user-scoped and don't fit.
 *
 * **Seat-based.** The node product is a seat-based price; seats = the org's
 * billable node count (see `requiredSeats` in ./index.ts). Per-seat trial isn't
 * a Polar primitive, so the "first node free for 30 days" grant is applied
 * panel-side by excluding one node from the seat count during the window — Polar
 * only ever sees the paid seat count.
 */

let cached: Polar | null | undefined;

/** The Polar client, or null when no access token is set. Built once, lazily. */
export function polarClient(): Polar | null {
	if (cached === undefined) {
		cached = env.POLAR_ACCESS_TOKEN
			? new Polar({
					accessToken: env.POLAR_ACCESS_TOKEN,
					server: env.POLAR_SERVER,
				})
			: null;
	}
	return cached;
}

/**
 * Whether billing is fully configured — a token *and* the node product to
 * subscribe to. The gate and seat-sync no-op until both are present, so the
 * panel runs unmetered without Polar (the phase rule) and a self-host stays free.
 */
export function billingConfigured(): boolean {
	return !!env.POLAR_ACCESS_TOKEN && !!env.POLAR_NODE_PRODUCT_ID;
}

/** Throw-if-unconfigured accessor for the call sites that require Polar. */
function requireClient(): { client: Polar; productId: string } {
	const client = polarClient();
	if (!client || !env.POLAR_NODE_PRODUCT_ID) {
		throw new Error("Billing is not configured.");
	}
	return { client, productId: env.POLAR_NODE_PRODUCT_ID };
}

/**
 * A hosted Polar checkout URL for the org's node subscription. Binds the
 * checkout to the org via `externalCustomerId` (Polar makes/links the customer)
 * and pre-sets the seat count; the browser is redirected here to enter a card.
 */
export async function createNodeCheckoutUrl(opts: {
	orgId: string;
	seats: number;
	successUrl: string;
}): Promise<string> {
	const { client, productId } = requireClient();
	const checkout = await client.checkouts.create({
		products: [productId],
		externalCustomerId: opts.orgId,
		seats: Math.max(1, opts.seats),
		successUrl: opts.successUrl,
		metadata: { orgId: opts.orgId },
	});
	return checkout.url;
}

/**
 * A hosted Polar customer-portal URL for the org (manage card, view invoices,
 * cancel). Resolves the customer by `externalCustomerId = orgId`; only valid
 * once the org has a Polar customer (i.e. after a first checkout).
 */
export async function createPortalUrl(orgId: string): Promise<string> {
	const { client } = requireClient();
	const session = await client.customerSessions.create({
		externalCustomerId: orgId,
	});
	return session.customerPortalUrl;
}

/** Set the seat count on an existing seat-based subscription. */
export async function updateSubscriptionSeats(
	subscriptionId: string,
	seats: number
): Promise<void> {
	const { client } = requireClient();
	await client.subscriptions.update({
		id: subscriptionId,
		subscriptionUpdate: { seats: Math.max(1, seats) },
	});
}

/** Flip cancel-at-period-end on a subscription (cancel, or undo to resume). */
export async function setSubscriptionCancel(
	subscriptionId: string,
	cancelAtPeriodEnd: boolean
): Promise<void> {
	const { client } = requireClient();
	await client.subscriptions.update({
		id: subscriptionId,
		subscriptionUpdate: { cancelAtPeriodEnd },
	});
}
