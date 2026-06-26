import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { node } from "./nodes";

/** Non-secret player-set variable values (envVariable → value), client-safe. */
export type ServerVariables = Record<string, string>;
/** Secret variable values, sealed (envVariable → AES-GCM ciphertext). Never returned. */
export type SealedVariables = Record<string, string>;

/**
 * Server registry — the panel's *desired* state for a Docker container deployed
 * from a Egg. The container itself (and its live cpu/mem/uptime) is
 * daemon-owned; this row holds intent: which node, the egg snapshot, the
 * resolved image (server-only), limits, and the variable values. `state` is the
 * last-observed lifecycle the daemon reconciles onto.
 *
 * Two FKs: `organizationId` (the repository's IDOR backstop, cascades with the
 * org) and `nodeId` (placement; cascades with the node). The image string lives
 * here server-only — the client never sees it (eggs-over-images).
 */
export const server = pgTable(
	"server",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		nodeId: text("node_id")
			.notNull()
			.references(() => node.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		// Egg snapshot at creation — friendly labels for the UI; the source
		// egg can change or be deleted without affecting a running server.
		eggId: text("egg_id").notNull(),
		eggName: text("egg_name").notNull(),
		eggVersion: integer("egg_version").notNull().default(1),
		imageLabel: text("image_label").notNull(),
		// SERVER-ONLY: the resolved Docker image string. Never projected to the client.
		image: text("image").notNull(),
		startupCommand: text("startup_command").notNull().default(""),
		stopSignal: text("stop_signal"),
		// Last-observed lifecycle state (running/stopped/starting/installing/failed),
		// the daemon's actual reconciled onto this desired-state row.
		state: text("state").notNull().default("installing"),
		port: integer("port"),
		cpuLimitMillicores: integer("cpu_limit_millicores").notNull(),
		memLimitBytes: bigint("mem_limit_bytes", { mode: "number" }).notNull(),
		diskLimitBytes: bigint("disk_limit_bytes", { mode: "number" }).notNull(),
		variables: jsonb("variables")
			.$type<ServerVariables>()
			.notNull()
			.default({}),
		// Write-only: secret values sealed with AAD bound to org+server+envVar.
		secretVariables: jsonb("secret_variables")
			.$type<SealedVariables>()
			.notNull()
			.default({}),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at")
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("server_organization_id_idx").on(table.organizationId),
		index("server_node_id_idx").on(table.nodeId),
	]
);
