import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization } from "./auth";
import { node } from "./nodes";
import { server } from "./servers";

/**
 * Port allocation — the **panel-owned** registry of port slots on a node (the one
 * panel-owned piece of the otherwise daemon-derived networking model). A slot is
 * a `(node, ip, port, protocol)` bind, optionally held by a server. The daemon's
 * firewall opens/closes in lockstep with these rows. A free slot can be released;
 * one a server holds is freed when the server is deleted (cascade).
 *
 * Org-scoped (the IDOR backstop) and node-scoped; the unique `(node, port,
 * protocol)` index is the double-bind guard, enforced at the DB.
 */
export const allocation = pgTable(
	"allocation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		nodeId: text("node_id")
			.notNull()
			.references(() => node.id, { onDelete: "cascade" }),
		// null = a free slot; else the server that holds it. Cascades when the
		// server is deleted (the service closes the firewall first).
		serverId: text("server_id").references(() => server.id, {
			onDelete: "cascade",
		}),
		// "0.0.0.0" = all interfaces.
		ip: text("ip").notNull().default("0.0.0.0"),
		port: integer("port").notNull(),
		protocol: text("protocol").$type<"tcp" | "udp">().notNull().default("tcp"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("allocation_organization_id_idx").on(table.organizationId),
		index("allocation_node_id_idx").on(table.nodeId),
		// One slot per (node, port, protocol) — the double-bind guard, at the DB.
		uniqueIndex("allocation_node_port_proto_uidx").on(
			table.nodeId,
			table.port,
			table.protocol
		),
	]
);
