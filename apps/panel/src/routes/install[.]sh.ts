import { createFileRoute } from "@tanstack/react-router";
import { renderInstallScript } from "@/server/nodes/install-script";

/**
 * Serves the one-line node installer at `/install.sh` (the enrollment command
 * curls this). Rendered server-side with the panel's pinned daemon release baked
 * in. No auth: the script carries no secrets — the per-node bootstrap token is
 * passed as an argument by the operator, not embedded here.
 */
export const Route = createFileRoute("/install.sh")({
	server: {
		handlers: {
			GET: () => renderInstallScript(),
		},
	},
});
