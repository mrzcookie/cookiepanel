import {
	bigint,
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";

/**
 * Node registry — panel-owned *desired* state. Live fields (status, hardware,
 * usage, heartbeats) are daemon-derived and merged at read time once the daemon
 * exists; they are NOT stored here. Every row is scoped to an organization, the
 * FK that the repository's org-scoping enforces.
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
		// Single-use enrollment bootstrap token: only the hash + expiry are kept.
		enrollmentTokenHash: text("enrollment_token_hash"),
		enrollmentTokenExpiresAt: timestamp("enrollment_token_expires_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("node_organization_id_idx").on(table.organizationId)]
);
