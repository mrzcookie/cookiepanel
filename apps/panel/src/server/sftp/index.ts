import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DaemonRead } from "@/lib/domain/nodes";
import type { SftpSession, SftpStatus } from "@/lib/domain/sftp";
import { requireOrg } from "@/server/auth/guards";
import {
	DaemonError,
	getSftpSession,
	mintSftpSession,
	revokeSftpSession,
} from "@/server/nodes/daemon-client";
import { nodesRepository } from "@/server/nodes/repository";
import { serversRepository } from "@/server/servers/repository";

/**
 * SFTP-session server functions: mint / status / revoke, each org+server-scoped
 * (generic not-found so cross-org ids can't be probed). The host the user
 * connects to is the operator-set node FQDN — never the daemon's self-report.
 *
 * Index-only: exports nothing but `createServerFn` values (the DB + daemon client
 * stay out of the client bundle).
 */

const input = z.object({ serverId: z.uuid() });

/** Resolve a server scoped to the caller's org and its node's connect host. */
async function requireServerHost(
	serverId: string
): Promise<{ nodeId: string; host: string }> {
	const { orgId } = await requireOrg();
	const server = await serversRepository.findById(orgId, serverId);
	if (!server) {
		throw new Error("Not found");
	}
	const node = await nodesRepository.findById(orgId, server.nodeId);
	if (!node) {
		throw new Error("Not found");
	}
	return { nodeId: server.nodeId, host: node.fqdn };
}

export const openSftpSession = createServerFn({ method: "POST" })
	.validator(input)
	.handler(async ({ data }): Promise<SftpSession> => {
		const { nodeId, host } = await requireServerHost(data.serverId);
		const minted = await mintSftpSession(nodeId, data.serverId);
		return {
			host,
			port: minted.port,
			username: minted.username,
			password: minted.password,
			expiresAt: minted.expiresAt,
		};
	});

export const sftpSessionStatus = createServerFn({ method: "GET" })
	.validator(input)
	.handler(async ({ data }): Promise<DaemonRead<SftpStatus>> => {
		const { nodeId, host } = await requireServerHost(data.serverId);
		try {
			const status = await getSftpSession(nodeId, data.serverId);
			return {
				ok: true,
				data: {
					active: status.active,
					host,
					port: status.port,
					username: status.username ?? null,
					expiresAt: status.expiresAt ?? null,
				},
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

export const closeSftpSession = createServerFn({ method: "POST" })
	.validator(input)
	.handler(async ({ data }) => {
		const { nodeId } = await requireServerHost(data.serverId);
		await revokeSftpSession(nodeId, data.serverId);
		return { ok: true as const };
	});
