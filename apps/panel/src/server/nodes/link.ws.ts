// @ts-nocheck — bundled by Nitro (which resolves `h3`); excluded from tsc.
import { defineWebSocketHandler } from "h3";
import { daemonLinkHooks } from "./link-handler";

/**
 * The daemon-facing WebSocket endpoint (`/api/daemon/v1/link`). Registered as a
 * Nitro handler in vite.config.ts (features.websocket) — the daemon dials this,
 * authenticates its node key, and serves the API over the socket.
 */
export default defineWebSocketHandler(daemonLinkHooks);
