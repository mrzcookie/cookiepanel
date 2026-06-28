// Debug diagnostics types (client-safe). The /admin/debug surface projects each
// node down to its connectivity/cert/heartbeat health — never a secret. The node
// key, signing secret, and the full cert fingerprint stay server-side; only the
// TLS mode (and a short, non-secret fingerprint prefix for cert-pinning triage)
// crosses the wire.

import type { NodeStatus } from "@/lib/domain/nodes";

/** How the panel verifies the daemon's TLS: pin the self-signed leaf, trust the
 * public ACME chain, or unknown until the box first reports a cert. */
export type DebugTlsMode = "pinned" | "acme" | "unknown";

/** The result of a live reachability probe against a node's daemon. */
export type DebugConnectivity =
	| { ok: true; latencyMs: number }
	| { ok: false; error: string };

/** One node's debug readout for the diagnostics table. */
export type DebugNodeRow = {
	id: string;
	name: string;
	/** Where the panel reaches the daemon. */
	fqdn: string;
	daemonPort: number;
	status: NodeStatus;
	tlsMode: DebugTlsMode;
	/** First 12 hex chars of the pinned leaf fingerprint — a diagnostic aid for
	 * cert-pinning triage, not a secret. null for ACME / not-yet-reported. */
	certFingerprintPrefix: string | null;
	/** Pre-formatted relative time, or null when the box has never heartbeated. */
	lastHeartbeat: string | null;
	daemonVersion: string | null;
	updateAvailable: boolean;
	/** Live reachability over the pinned HTTPS channel. */
	connectivity: DebugConnectivity;
};
