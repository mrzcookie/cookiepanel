import { createFileRoute } from "@tanstack/react-router";
import { uploadForRequest } from "@/server/files/transfer";

/**
 * Receives a raw file body and writes it into a server's data volume (panel →
 * daemon, pinned). The handler re-scopes to the caller's org + server before
 * reaching the box.
 */
export const Route = createFileRoute("/api/files/upload")({
	server: {
		handlers: {
			POST: ({ request }) => uploadForRequest(request),
		},
	},
});
