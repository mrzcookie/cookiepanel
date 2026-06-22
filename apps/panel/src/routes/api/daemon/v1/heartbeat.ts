import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { DaemonSystemInfo } from "@/server/db/schema/nodes";
import {
	EnrollmentError,
	recordHeartbeat,
	requestClientIp,
} from "@/server/nodes/enrollment";

/**
 * Daemon heartbeat endpoint. The box POSTs here every ~30s with its live system
 * info, cert fingerprint, and API port, authenticated by the durable node key
 * (`Authorization: Bearer <node key>`). The panel merges the state onto the node
 * row, which is what flips a node `pending → online`. Returns 204.
 */

const Body = z.object({
	systemInfo: z.record(z.string(), z.unknown()).optional(),
	certFingerprint: z.string().optional(),
	daemonPort: z.number().int().min(1).max(65535).optional(),
});

function bearer(request: Request): string | null {
	const header = request.headers.get("authorization") ?? "";
	return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export const Route = createFileRoute("/api/daemon/v1/heartbeat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const nodeKey = bearer(request);
				if (!nodeKey) {
					return json({ error: "Missing bearer token" }, 401);
				}
				const parsed = Body.safeParse(await request.json().catch(() => ({})));
				if (!parsed.success) {
					return json({ error: "Invalid request" }, 400);
				}
				try {
					await recordHeartbeat({
						nodeKey,
						systemInfo: parsed.data.systemInfo as DaemonSystemInfo | undefined,
						certFingerprint: parsed.data.certFingerprint,
						daemonPort: parsed.data.daemonPort,
						observedIp: requestClientIp(request),
					});
					return new Response(null, { status: 204 });
				} catch (error) {
					if (error instanceof EnrollmentError) {
						return json({ error: error.message }, error.status);
					}
					return json({ error: "Heartbeat failed" }, 500);
				}
			},
		},
	},
});
