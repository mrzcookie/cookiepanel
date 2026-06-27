import { randomBytes } from "node:crypto";
import { seal, sha256Hex, timingSafeEqualHex } from "@/server/crypto";
import type { DaemonSystemInfo } from "@/server/db/schema/nodes";
import { reconcileManagedNodeDns } from "./dns";
import { nodesRepository } from "./repository";

/**
 * The daemon-facing half of the node lifecycle: enrollment (exchange a single-use
 * bootstrap token for durable credentials) and heartbeat (merge the box's live
 * state onto its registry row). Called by the `/api/daemon/v1/*` routes — these
 * are authenticated by the node credential, not a tenant session, so nothing here
 * is org-scoped. Transport-agnostic: the routes own HTTP shaping.
 *
 * Trust boundary (architecture.md / security.md): the panel never trusts the
 * daemon's self-reported FQDN — the address is operator-owned, set at node
 * creation. Only the cert fingerprint and the observed source IP are taken from
 * the box.
 */

export class EnrollmentError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.name = "EnrollmentError";
		this.status = status;
	}
}

// One opaque message for every enrollment failure (bad/expired/already-used token,
// unknown node) so node ids and token validity can't be probed.
const ENROLL_REJECT = "Invalid or expired bootstrap token";

// Bind each sealed secret to its node + role, so a ciphertext can't be lifted to
// another node or swapped between the two secrets. `nodeKeyAad` is exported so
// the daemon-client can unseal the node key with the same context to dial out.
export const nodeKeyAad = (nodeId: string) => `node-key:${nodeId}`;
// Exported so the console-token minter can unseal the signing secret under the
// same context to sign the browser JWT.
export const signingSecretAad = (nodeId: string) => `signing-secret:${nodeId}`;

/**
 * Exchange a bootstrap token for the durable node key + signing secret, returned
 * exactly once. Burns the token. Throws `EnrollmentError` (always the same opaque
 * message) on any validation failure.
 */
export async function activateNode(input: {
	nodeId: string;
	bootstrapToken: string;
	certFingerprint?: string;
	observedIp: string | null;
}): Promise<{ nodeKey: string; signingSecret: string }> {
	const cred = await nodesRepository.findEnrollment(input.nodeId);
	if (!(cred?.bootstrapTokenHash && cred.bootstrapExpiresAt)) {
		throw new EnrollmentError(ENROLL_REJECT);
	}
	if (cred.bootstrapExpiresAt.getTime() < Date.now()) {
		throw new EnrollmentError(ENROLL_REJECT);
	}
	if (
		!timingSafeEqualHex(
			sha256Hex(input.bootstrapToken),
			cred.bootstrapTokenHash
		)
	) {
		throw new EnrollmentError(ENROLL_REJECT);
	}

	const nodeKey = `nk_${randomBytes(32).toString("base64url")}`;
	const signingSecret = `ss_${randomBytes(32).toString("base64url")}`;

	const burned = await nodesRepository.activate(input.nodeId, {
		nodeKeyHash: sha256Hex(nodeKey),
		nodeKeyCiphertext: seal(nodeKey, nodeKeyAad(input.nodeId)),
		signingSecretCiphertext: seal(
			signingSecret,
			signingSecretAad(input.nodeId)
		),
		certFingerprint: input.certFingerprint ?? null,
		publicIp: input.observedIp,
	});
	// Lost the race to a concurrent activation — the token is single-use spent.
	// (The minted keys above are simply discarded.)
	if (!burned) {
		throw new EnrollmentError(ENROLL_REJECT);
	}

	// Managed nodes: now that we've observed the box's public IP, point its
	// panel-owned subdomain at it. Best-effort + a no-op without Cloudflare; on
	// success record the synced IP so the heartbeat won't redo it every beat — and
	// will self-heal it if this didn't take (e.g. Cloudflare wasn't configured yet).
	if (cred.managed && input.observedIp) {
		if (await reconcileManagedNodeDns(cred.fqdn, input.observedIp)) {
			await nodesRepository.markDnsSynced(input.nodeId, input.observedIp);
		}
	}

	return { nodeKey, signingSecret };
}

/**
 * Authenticate a heartbeat by its node key and merge the reported live state onto
 * the node row. Throws `EnrollmentError(401)` if the key matches no node.
 */
export async function recordHeartbeat(input: {
	nodeKey: string;
	systemInfo?: DaemonSystemInfo;
	certFingerprint?: string;
	daemonPort?: number;
	observedIp: string | null;
}): Promise<void> {
	const found = await nodesRepository.findNodeByKeyHash(
		sha256Hex(input.nodeKey)
	);
	if (!found) {
		throw new EnrollmentError("Unknown node", 401);
	}

	await nodesRepository.recordHeartbeat(found.nodeId, {
		at: new Date(),
		systemInfo: input.systemInfo,
		certFingerprint: input.certFingerprint,
		daemonPort: input.daemonPort,
		publicIp: input.observedIp ?? undefined,
	});

	// Self-heal the managed subdomain's A record. Reconcile when we've never
	// successfully written it (`dnsSyncedIp` is null — e.g. the node enrolled
	// before Cloudflare was configured) or the box's IP moved, then remember the
	// synced IP so we don't call Cloudflare on every ~30s beat. A no-op (Cloudflare
	// unconfigured) or a failure leaves it unsynced, so the next beat retries.
	if (
		found.managed &&
		input.observedIp &&
		input.observedIp !== found.dnsSyncedIp
	) {
		if (await reconcileManagedNodeDns(found.fqdn, input.observedIp)) {
			await nodesRepository.markDnsSynced(found.nodeId, input.observedIp);
		}
	}
}

/**
 * The observed client IP of a daemon request. Behind Cloudflare (managed nodes),
 * `CF-Connecting-IP` is the verified peer and can't be spoofed by the caller, so
 * prefer it; then `X-Real-IP`; then `X-Forwarded-For`.
 *
 * SECURITY: for XFF we take the **right-most** entry — the IP appended by the
 * closest proxy — never the left-most. The left-most is whatever the original
 * caller claimed (an attacker can prepend `X-Forwarded-For: 1.2.3.4` to spoof it);
 * the right-most is set by your own trusted ingress and can't be prepended away.
 * This still only holds behind a trusted ingress, which is why CF-Connecting-IP /
 * X-Real-IP are preferred. The value only feeds display + the node's own managed
 * DNS, and enrollment/heartbeat are credential-authenticated, so the blast radius
 * is a node mislabeling its own IP — never cross-tenant.
 */
export function requestClientIp(request: Request): string | null {
	const cf = request.headers.get("cf-connecting-ip");
	if (cf) {
		return cf.trim() || null;
	}
	const real = request.headers.get("x-real-ip");
	if (real) {
		return real.trim() || null;
	}
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		return forwarded.split(",").at(-1)?.trim() || null;
	}
	return null;
}
