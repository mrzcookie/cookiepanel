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
const signingSecretAad = (nodeId: string) => `signing-secret:${nodeId}`;

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

	await nodesRepository.activate(input.nodeId, {
		nodeKeyHash: sha256Hex(nodeKey),
		nodeKeyCiphertext: seal(nodeKey, nodeKeyAad(input.nodeId)),
		signingSecretCiphertext: seal(
			signingSecret,
			signingSecretAad(input.nodeId)
		),
		certFingerprint: input.certFingerprint ?? null,
		publicIp: input.observedIp,
	});

	// Managed nodes: now that we've observed the box's public IP, point its
	// panel-owned subdomain at it. Best-effort + a no-op without Cloudflare.
	if (cred.managed && input.observedIp) {
		await reconcileManagedNodeDns(cred.fqdn, input.observedIp);
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

	// Keep a managed node's A record on the current IP, but only when it actually
	// changed — otherwise we'd hit Cloudflare on every ~30s beat.
	if (
		found.managed &&
		input.observedIp &&
		input.observedIp !== found.publicIp
	) {
		await reconcileManagedNodeDns(found.fqdn, input.observedIp);
	}
}

/** The observed client IP of a daemon request (XFF-aware), or null. */
export function requestClientIp(request: Request): string | null {
	const forwarded = request.headers.get("x-forwarded-for");
	if (forwarded) {
		return forwarded.split(",")[0]?.trim() || null;
	}
	return request.headers.get("x-real-ip");
}
