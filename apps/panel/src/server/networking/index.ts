import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { NetworkDriver, NetworkRow } from "@/lib/domain/networks";
import type {
	DaemonRead,
	FirewallBackend,
	FirewallRow,
} from "@/lib/domain/nodes";
import { requireOrg } from "@/server/auth/guards";
import {
	createNetworkOnNode,
	DaemonError,
	type DaemonFirewall,
	type DaemonNetwork,
	deleteNetworkOnNode,
	getNodeFirewall,
	getNodeNetworks,
	setNetworkAttachment,
} from "@/server/nodes/daemon-client";
import { nodesRepository } from "@/server/nodes/repository";
import { serversRepository } from "@/server/servers/repository";

/**
 * Networks + firewall are **daemon-derived** (no panel table): reads dial the box
 * on demand and degrade to `{ ok: false }` when it's unreachable; mutations are
 * straight daemon calls scoped to a node the caller owns. Port allocations (the
 * panel-owned half) live in `server/allocations`.
 */

const DRIVERS: NetworkDriver[] = ["bridge", "macvlan", "ipvlan"];

function toNetworkRow(
	n: DaemonNetwork,
	nodeId: string,
	nodeName: string
): NetworkRow {
	const driver = (DRIVERS as string[]).includes(n.driver)
		? (n.driver as NetworkDriver)
		: "bridge";
	return {
		id: n.networkId,
		// The daemon names the docker network `cookied-<name>`; show the friendly name.
		name: n.name.replace(/^cookied-/, ""),
		nodeId,
		nodeName,
		driver,
		subnet: n.subnet ?? null,
		gateway: n.gateway ?? null,
		// `internal` + attached server membership aren't in the daemon's network
		// list; they fill in when the daemon reports them (a later refinement).
		internal: false,
		serverIds: [],
	};
}

function toFirewallRow(d: DaemonFirewall, nodeId: string): FirewallRow {
	const backend: FirewallBackend =
		d.backend === "ufw"
			? "ufw"
			: d.backend === "iptables"
				? "iptables"
				: "none";
	return {
		nodeId,
		backend,
		active: d.active,
		rules: d.rules.map((r) => ({
			port: r.port,
			protocol: r.protocol === "udp" ? "udp" : "tcp",
		})),
	};
}

// ─── reads (on-demand, degrade gracefully) ───────────────────────────────────

/** Every network across the org's online nodes (unreachable nodes contribute none). */
export const listNetworks = createServerFn({ method: "GET" }).handler(
	async () => {
		const { orgId } = await requireOrg();
		const nodes = await nodesRepository.list(orgId);
		const perNode = await Promise.all(
			nodes.map(async (node) => {
				try {
					const nets = await getNodeNetworks(node.id);
					return nets.map((n) => toNetworkRow(n, node.id, node.name));
				} catch {
					return [] as NetworkRow[];
				}
			})
		);
		return perNode.flat();
	}
);

const nodeIdInput = z.object({ nodeId: z.uuid() });

export const nodeFirewall = createServerFn({ method: "GET" })
	.validator(nodeIdInput)
	.handler(async ({ data }): Promise<DaemonRead<FirewallRow>> => {
		const { orgId } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.nodeId))) {
			throw new Error("Not found");
		}
		try {
			return {
				ok: true,
				data: toFirewallRow(await getNodeFirewall(data.nodeId), data.nodeId),
			};
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof DaemonError
						? error.message
						: "Could not reach the node",
			};
		}
	});

// ─── mutations ───────────────────────────────────────────────────────────────

export const createNetwork = createServerFn({ method: "POST" })
	.validator(
		z.object({
			nodeId: z.uuid(),
			name: z.string().trim().min(1).max(63),
			driver: z.enum(["bridge", "macvlan", "ipvlan"]).default("bridge"),
			subnet: z.string().trim().optional(),
			gateway: z.string().trim().optional(),
		})
	)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const node = await nodesRepository.findById(orgId, data.nodeId);
		if (!node) {
			throw new Error("Not found");
		}
		const created = await createNetworkOnNode(data.nodeId, {
			networkId: randomUUID(),
			name: data.name,
			driver: data.driver,
			subnet: data.subnet,
			gateway: data.gateway,
		});
		return toNetworkRow(created, node.id, node.name);
	});

export const deleteNetwork = createServerFn({ method: "POST" })
	.validator(z.object({ nodeId: z.uuid(), networkId: z.uuid() }))
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		if (!(await nodesRepository.findById(orgId, data.nodeId))) {
			throw new Error("Not found");
		}
		await deleteNetworkOnNode(data.nodeId, data.networkId);
		return { networkId: data.networkId };
	});

export const setServerNetwork = createServerFn({ method: "POST" })
	.validator(
		z.object({
			networkId: z.uuid(),
			serverId: z.uuid(),
			action: z.enum(["attach", "detach"]),
		})
	)
	.handler(async ({ data }) => {
		const { orgId } = await requireOrg();
		const server = await serversRepository.findById(orgId, data.serverId);
		if (!server) {
			throw new Error("Not found");
		}
		await setNetworkAttachment(
			server.nodeId,
			data.networkId,
			data.serverId,
			data.action
		);
		return { ok: true as const };
	});
