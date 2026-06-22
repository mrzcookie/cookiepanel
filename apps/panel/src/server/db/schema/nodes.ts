import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

/**
 * The daemon's self-reported system snapshot, merged onto the node row at
 * heartbeat (see `node.systemInfo`). The daemon owns this shape; the panel stores
 * the blob verbatim and projects the client-safe bits onto `NodeRow` at read time.
 */
export type DaemonSystemInfo = {
	os?: string;
	arch?: string;
	cpus?: number;
	memTotalBytes?: number;
	diskTotalBytes?: number;
	daemonVersion?: string;
	docker?: {
		available?: boolean;
		serverVersion?: string;
		containers?: number;
		running?: number;
		images?: number;
		error?: string;
	};
};

/**
 * Node registry — panel-owned *desired* state, plus the thin slice of
 * daemon-derived *live* state the heartbeat merges in (status is derived from
 * `lastHeartbeatAt` at read time; hardware/Docker counts come from `systemInfo`).
 * Secrets live off this row in `node_credential`. Every row is org-scoped — the
 * FK the repository's org-scoping enforces.
 */
export const node = pgTable(
	"node",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		// Display name; the stable identity is `id`, not this.
		name: text("name").notNull(),
		// Operator-owned address where the panel reaches the daemon.
		fqdn: text("fqdn").notNull(),
		daemonPort: integer("daemon_port").notNull().default(8443),
		// Panel minted a subdomain + DNS, vs. an operator-pointed address.
		managed: boolean("managed").notNull().default(false),
		// Operator-set allocatable caps (at/below detected hardware); null until set.
		capCpuCores: integer("cap_cpu_cores"),
		capMemBytes: bigint("cap_mem_bytes", { mode: "number" }),
		capDiskBytes: bigint("cap_disk_bytes", { mode: "number" }),
		// Live state, merged in at heartbeat. Null until the box first reports.
		lastHeartbeatAt: timestamp("last_heartbeat_at"),
		systemInfo: jsonb("system_info").$type<DaemonSystemInfo>(),
		// Observed source IP of the daemon's enrollment/heartbeat (never self-reported).
		publicIp: text("public_ip"),
		// sha256 of the daemon's self-signed leaf cert (or the "acme" sentinel); the
		// panel pins this when it dials the box. Reported via the heartbeat.
		certFingerprint: text("cert_fingerprint"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("node_organization_id_idx").on(table.organizationId)]
);

/**
 * Per-node credential material — kept off the registry row so secrets aren't read
 * on every node list/detail query. **Not org-scoped:** the daemon authenticates
 * with the credential itself (the single-use bootstrap token, then the durable
 * node key), never a tenant session, so the daemon-facing paths look these up by
 * node id / key hash directly. Cascades with its node.
 *
 * Lifecycle: created with the node holding only the bootstrap token hash + expiry;
 * at activation the panel mints the durable node key + signing secret, stores the
 * key as both a hash (inbound O(1) auth) and an AES-GCM ciphertext (so it can
 * recover the plaintext to dial out), and **nulls the bootstrap fields** so the
 * token is single-use.
 */
export const nodeCredential = pgTable(
	"node_credential",
	{
		nodeId: text("node_id")
			.primaryKey()
			.references(() => node.id, { onDelete: "cascade" }),
		bootstrapTokenHash: text("bootstrap_token_hash"),
		bootstrapExpiresAt: timestamp("bootstrap_expires_at"),
		nodeKeyHash: text("node_key_hash"),
		nodeKeyCiphertext: text("node_key_ciphertext"),
		signingSecretCiphertext: text("signing_secret_ciphertext"),
		activatedAt: timestamp("activated_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("node_credential_key_hash_idx").on(table.nodeKeyHash)]
);
