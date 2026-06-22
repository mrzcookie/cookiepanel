import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
	activateNode,
	EnrollmentError,
	requestClientIp,
} from "@/server/nodes/enrollment";

/**
 * Daemon enrollment endpoint. The box calls this once with the single-use
 * bootstrap token from its install command; the panel validates + burns the
 * token, mints the durable node key + signing secret, and returns them exactly
 * once. Authenticated by the token itself, so it's a bare server route (no tenant
 * session). The daemon's self-reported `fqdn` is accepted but ignored — see
 * `enrollment.ts`.
 */

const Body = z.object({
	nodeId: z.string().min(1),
	bootstrapToken: z.string().min(1),
	fqdn: z.string().optional(),
	certFingerprint: z.string().optional(),
});

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export const Route = createFileRoute("/api/daemon/v1/nodes/activate")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const parsed = Body.safeParse(await request.json().catch(() => null));
				if (!parsed.success) {
					return json({ error: "Invalid request" }, 400);
				}
				try {
					const credentials = await activateNode({
						nodeId: parsed.data.nodeId,
						bootstrapToken: parsed.data.bootstrapToken,
						certFingerprint: parsed.data.certFingerprint,
						observedIp: requestClientIp(request),
					});
					return json(credentials, 200);
				} catch (error) {
					if (error instanceof EnrollmentError) {
						return json({ error: error.message }, error.status);
					}
					return json({ error: "Activation failed" }, 500);
				}
			},
		},
	},
});
