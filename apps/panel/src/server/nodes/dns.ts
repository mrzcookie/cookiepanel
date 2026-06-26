import { env } from "@/server/env";

/**
 * Cloudflare DNS for managed nodes — the auto-DNS behind the "Raptor
 * subdomain" enrollment path. A managed node is reachable at
 * `<slug>.<NODES_DOMAIN>`; this module points that hostname's A record at the
 * node's public IP via the Cloudflare API (v4).
 *
 * **The IP is daemon-derived.** The panel learns a box's public IP only when the
 * box calls home (the observed source IP of the daemon's enrollment/heartbeat —
 * see architecture.md), which is the daemon phase and not built yet. So the
 * create/update side has no live caller today; the daemon enrollment handler will
 * call `reconcileManagedNodeDns(fqdn, observedIp)` once it lands. The delete side
 * *is* live: removing a managed node tears its record down.
 *
 * Server-only (reads the Cloudflare token). Optional + best-effort: a no-op when
 * the `CLOUDFLARE_*` creds are absent, and it never throws into its caller — DNS
 * is auxiliary to node create/remove, not a hard dependency.
 */

const CF_API = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 10_000;

// Validate before we put anything on the wire: a full hostname, and a dotted
// IPv4 with each octet in range. Cloudflare would reject malformed input anyway,
// but failing fast keeps junk out of the API and the logs.
const HOSTNAME =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function isIpv4(value: string): boolean {
	const parts = value.split(".");
	return (
		parts.length === 4 &&
		parts.every((part) => {
			if (!/^\d{1,3}$/.test(part)) {
				return false;
			}
			const n = Number(part);
			return n >= 0 && n <= 255;
		})
	);
}

function cloudflareConfigured(): boolean {
	return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

type CloudflareResponse<T> = {
	success: boolean;
	errors?: { code: number; message: string }[];
	result: T;
};

type DnsRecord = { id: string; name: string; content: string };

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(
		`${CF_API}/zones/${env.CLOUDFLARE_ZONE_ID}${path}`,
		{
			...init,
			headers: {
				authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
				"content-type": "application/json",
				...init?.headers,
			},
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		}
	);

	const body = (await response.json()) as CloudflareResponse<T>;
	if (!(response.ok && body.success)) {
		const detail =
			body.errors?.map((error) => error.message).join("; ") ||
			`HTTP ${response.status}`;
		throw new Error(`Cloudflare API: ${detail}`);
	}
	return body.result;
}

/** The existing A record for a hostname, or null. */
async function findARecord(fqdn: string): Promise<DnsRecord | null> {
	const records = await cloudflare<DnsRecord[]>(
		`/dns_records?type=A&name=${encodeURIComponent(fqdn)}`
	);
	return records.at(0) ?? null;
}

/**
 * Point a managed node's subdomain at an IP, or tear the record down.
 *
 * - `ip` set   → upsert the A record (`<fqdn> → ip`, DNS-only / unproxied so the
 *   daemon port and ACME challenge reach the box). Called by the daemon
 *   enrollment path once it observes the node's public IP (daemon phase).
 * - `ip` null  → delete the A record. Called when a managed node is removed.
 *
 * No-op when Cloudflare isn't configured; swallows + logs failures so it never
 * breaks node create/remove.
 */
export async function reconcileManagedNodeDns(
	fqdn: string,
	ip: string | null
): Promise<void> {
	if (!cloudflareConfigured()) {
		return;
	}
	if (!HOSTNAME.test(fqdn)) {
		console.error(`[dns] refusing to manage a malformed hostname: ${fqdn}`);
		return;
	}
	if (ip !== null && !isIpv4(ip)) {
		console.error(`[dns] refusing to point ${fqdn} at a non-IPv4: ${ip}`);
		return;
	}

	try {
		const existing = await findARecord(fqdn);

		if (ip === null) {
			if (existing) {
				await cloudflare(`/dns_records/${existing.id}`, { method: "DELETE" });
			}
			return;
		}

		const payload = JSON.stringify({
			type: "A",
			name: fqdn,
			content: ip,
			ttl: 60,
			proxied: false,
		});
		if (existing) {
			await cloudflare(`/dns_records/${existing.id}`, {
				method: "PUT",
				body: payload,
			});
		} else {
			await cloudflare("/dns_records", { method: "POST", body: payload });
		}
	} catch (error) {
		console.error(`[dns] Cloudflare reconcile failed for ${fqdn}:`, error);
	}
}
