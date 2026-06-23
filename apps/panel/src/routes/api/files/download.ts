import { createFileRoute } from "@tanstack/react-router";
import { downloadForRequest } from "@/server/files/transfer";

/**
 * Streams a server file's bytes to the browser (panel → daemon, pinned). A plain
 * GET so an `<a download>` / `window.open` can hit it with the session cookie;
 * the handler re-scopes to the caller's org + server before reaching the box.
 */
export const Route = createFileRoute("/api/files/download")({
	server: {
		handlers: {
			GET: ({ request }) => downloadForRequest(request),
		},
	},
});
