import { randomUUID } from "node:crypto";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/server/db";
import {
	type DaemonSystemInfo,
	node,
	nodeCredential,
} from "@/server/db/schema/nodes";

export type NodeRecord = typeof node.$inferSelect;
type NewNodeValues = Pick<
	typeof node.$inferInsert,
	"name" | "fqdn" | "daemonPort" | "managed"
>;
type NodePatch = Partial<
	Pick<
		typeof node.$inferInsert,
		| "name"
		| "fqdn"
		| "daemonPort"
		| "managed"
		| "capCpuCores"
		| "capMemBytes"
		| "capDiskBytes"
	>
>;

/** A node's bootstrap credential row at creation (only the token hash + expiry). */
type BootstrapCredential = {
	bootstrapTokenHash: string;
	bootstrapExpiresAt: Date;
};

/**
 * The only module that touches the `node` / `node_credential` tables.
 *
 * The registry methods are **org-scoped**: `organizationId` is ANDed into every
 * predicate (reads *and* writes), so a row in another org is indistinguishable
 * from a missing one — the IDOR backstop from security.md.
 *
 * The **daemon-facing** methods below (`findEnrollment`, `findNodeByKeyHash`,
 * `activate`, `recordHeartbeat`) are deliberately **not** org-scoped: the daemon
 * is not a tenant, it authenticates with the node credential itself (the bootstrap
 * token, then the node key), so these resolve a node by its credential, not by an
 * org session.
 */
export const nodesRepository = {
	// ─── org-scoped registry ───────────────────────────────────────────────────

	list: (orgId: string) =>
		db
			.select()
			.from(node)
			.where(eq(node.organizationId, orgId))
			.orderBy(desc(node.createdAt)),

	findById: (orgId: string, id: string) =>
		db
			.select()
			.from(node)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** How many nodes the org runs — the seat count billing gates against. */
	count: (orgId: string): Promise<number> =>
		db
			.select({ value: count() })
			.from(node)
			.where(eq(node.organizationId, orgId))
			.then((rows) => rows.at(0)?.value ?? 0),

	/** Whether this org already has a node at fqdn — the managed-subdomain
	 * collision guard (a managed subdomain derives from the node name). */
	fqdnExists: (orgId: string, fqdn: string): Promise<boolean> =>
		db
			.select({ id: node.id })
			.from(node)
			.where(and(eq(node.organizationId, orgId), eq(node.fqdn, fqdn)))
			.limit(1)
			.then((rows) => rows.length > 0),

	/** Insert a node and its bootstrap credential atomically. */
	create: async (
		orgId: string,
		values: NewNodeValues,
		bootstrap: BootstrapCredential
	): Promise<NodeRecord> => {
		const id = randomUUID();
		return db.transaction(async (tx) => {
			const [row] = await tx
				.insert(node)
				.values({ ...values, id, organizationId: orgId })
				.returning();
			if (!row) {
				throw new Error("Failed to create node");
			}
			await tx.insert(nodeCredential).values({ nodeId: id, ...bootstrap });
			return row;
		});
	},

	update: (orgId: string, id: string, patch: NodePatch) =>
		db
			.update(node)
			.set(patch)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.returning()
			.then((rows) => rows.at(0)),

	remove: (orgId: string, id: string) =>
		db
			.delete(node)
			.where(and(eq(node.id, id), eq(node.organizationId, orgId)))
			.returning({
				id: node.id,
				fqdn: node.fqdn,
				managed: node.managed,
			})
			.then((rows) => rows.at(0)),

	// ─── daemon-facing (credential-authenticated, not org-scoped) ───────────────

	/** The credential + the node's address, for the enrollment handler. */
	findEnrollment: (nodeId: string) =>
		db
			.select({
				bootstrapTokenHash: nodeCredential.bootstrapTokenHash,
				bootstrapExpiresAt: nodeCredential.bootstrapExpiresAt,
				fqdn: node.fqdn,
				managed: node.managed,
			})
			.from(nodeCredential)
			.innerJoin(node, eq(node.id, nodeCredential.nodeId))
			.where(eq(nodeCredential.nodeId, nodeId))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** Resolve a node from a node-key hash, for heartbeat auth. */
	findNodeByKeyHash: (nodeKeyHash: string) =>
		db
			.select({
				nodeId: nodeCredential.nodeId,
				managed: node.managed,
				fqdn: node.fqdn,
				// The IP last written to DNS, so the heartbeat self-heals a missing or
				// stale managed record without dialing Cloudflare every beat.
				dnsSyncedIp: node.dnsSyncedIp,
			})
			.from(nodeCredential)
			.innerJoin(node, eq(node.id, nodeCredential.nodeId))
			.where(eq(nodeCredential.nodeKeyHash, nodeKeyHash))
			.limit(1)
			.then((rows) => rows.at(0)),

	/** The sealed per-node signing secret, for minting the console JWT. */
	signingSecretCiphertextFor: (nodeId: string) =>
		db
			.select({ ciphertext: nodeCredential.signingSecretCiphertext })
			.from(nodeCredential)
			.where(eq(nodeCredential.nodeId, nodeId))
			.limit(1)
			.then((rows) => rows.at(0)?.ciphertext ?? null),

	/** Burn the bootstrap token and store the durable credentials, atomically. */
	activate: (
		nodeId: string,
		values: {
			nodeKeyHash: string;
			nodeKeyCiphertext: string;
			signingSecretCiphertext: string;
			certFingerprint: string | null;
			publicIp: string | null;
		}
	) =>
		db.transaction(async (tx) => {
			// Single-use CAS: only the first activation (bootstrap hash still set)
			// burns the token + stores the durable keys; a concurrent second matches
			// no row and aborts, so a token can't mint two node keys.
			const burned = await tx
				.update(nodeCredential)
				.set({
					nodeKeyHash: values.nodeKeyHash,
					nodeKeyCiphertext: values.nodeKeyCiphertext,
					signingSecretCiphertext: values.signingSecretCiphertext,
					activatedAt: new Date(),
					bootstrapTokenHash: null,
					bootstrapExpiresAt: null,
				})
				.where(
					and(
						eq(nodeCredential.nodeId, nodeId),
						isNotNull(nodeCredential.bootstrapTokenHash)
					)
				)
				.returning({ nodeId: nodeCredential.nodeId });
			if (burned.length === 0) {
				return false;
			}
			// Only touch the node row if the daemon reported something to merge — an
			// empty `.set({})` throws. A self-signed daemon has no fingerprint until
			// it serves TLS, and a same-host enroll has no observed IP, so both can
			// legitimately be absent here.
			const patch: Partial<typeof node.$inferInsert> = {};
			if (values.certFingerprint) {
				patch.certFingerprint = values.certFingerprint;
			}
			if (values.publicIp) {
				patch.publicIp = values.publicIp;
			}
			if (Object.keys(patch).length > 0) {
				await tx.update(node).set(patch).where(eq(node.id, nodeId));
			}
			return true;
		}),

	/** Merge a heartbeat's live state onto the node row. */
	recordHeartbeat: (
		nodeId: string,
		values: {
			at: Date;
			systemInfo?: DaemonSystemInfo;
			certFingerprint?: string;
			daemonPort?: number;
			publicIp?: string;
		}
	) =>
		db
			.update(node)
			.set({
				lastHeartbeatAt: values.at,
				...(values.systemInfo ? { systemInfo: values.systemInfo } : {}),
				...(values.certFingerprint
					? { certFingerprint: values.certFingerprint }
					: {}),
				...(values.daemonPort ? { daemonPort: values.daemonPort } : {}),
				...(values.publicIp ? { publicIp: values.publicIp } : {}),
			})
			.where(eq(node.id, nodeId)),

	/** Remember the IP we last successfully wrote to a managed node's DNS A
	 * record, so the heartbeat only reconciles when it's missing or the IP moved. */
	markDnsSynced: (nodeId: string, ip: string) =>
		db.update(node).set({ dnsSyncedIp: ip }).where(eq(node.id, nodeId)),
};
