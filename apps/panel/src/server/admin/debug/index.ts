import { createServerFn } from "@tanstack/react-start";
import type {
	DebugConnectivity,
	DebugNodeRow,
	DebugTlsMode,
} from "@/lib/domain/debug";
import { requireOrg, requirePlatformAdmin } from "@/server/auth/guards";
import { toNodeRow } from "@/server/nodes";
import { DaemonError, getNodeStats } from "@/server/nodes/daemon-client";
import { type NodeRecord, nodesRepository } from "@/server/nodes/repository";

/**
 * The /admin/debug diagnostics service — a per-node connectivity / cert /
 * heartbeat readout for operators.
 *
 * Gated **twice** (defense in depth, per security.md): the global platform-admin
 * capability (`requirePlatformAdmin`, the same guard every `admin/` server fn
 * enforces and that the `/admin` route layout gates the UI on), AND the caller's
 * active organization (`requireOrg`) — the diagnostics only ever cover that org's
 * own fleet, never another tenant's nodes.
 *
 * Server-only and client-safe by construction: it projects via `toNodeRow` and a
 * narrow debug projection, so no secret (node key, signing secret, full cert
 * fingerprint) is ever returned. The connectivity probe reuses the existing
 * pinned daemon client; the unsealed node key it dials with never leaves the box.
 */

// Sentinel the daemon reports in the cert-fingerprint slot for a publicly-trusted
// ACME cert (vs. a self-signed leaf the panel pins). Mirrors the daemon-client.
const ACME_FINGERPRINT = "acme";

function tlsModeOf(certFingerprint: string | null): DebugTlsMode {
	if (!certFingerprint) {
		return "unknown";
	}
	return certFingerprint === ACME_FINGERPRINT ? "acme" : "pinned";
}

/** Dial the node's daemon once to measure reachability. Degrades to a reason
 * string rather than throwing — an unreachable box is a finding, not an error. */
async function probeConnectivity(nodeId: string): Promise<DebugConnectivity> {
	const startedAt = Date.now();
	try {
		await getNodeStats(nodeId);
		return { ok: true, latencyMs: Date.now() - startedAt };
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof DaemonError
					? error.message
					: "Could not reach the node",
		};
	}
}

async function toDebugNodeRow(record: NodeRecord): Promise<DebugNodeRow> {
	const row = toNodeRow(record);
	const fingerprint = record.certFingerprint;
	const tlsMode = tlsModeOf(fingerprint);
	return {
		id: row.id,
		name: row.name,
		fqdn: row.fqdn,
		daemonPort: row.daemonPort,
		status: row.status,
		tlsMode,
		certFingerprintPrefix:
			tlsMode === "pinned" && fingerprint ? fingerprint.slice(0, 12) : null,
		lastHeartbeat: row.lastHeartbeat,
		daemonVersion: row.daemonVersion,
		updateAvailable: row.updateAvailable,
		connectivity: await probeConnectivity(record.id),
	};
}

export const listDebugNodes = createServerFn({ method: "GET" }).handler(
	async (): Promise<DebugNodeRow[]> => {
		await requirePlatformAdmin();
		const { orgId } = await requireOrg();
		const records = await nodesRepository.list(orgId);
		// Probe every node in parallel so one slow/offline box can't serialize the
		// whole page behind its timeout.
		return Promise.all(records.map(toDebugNodeRow));
	}
);
