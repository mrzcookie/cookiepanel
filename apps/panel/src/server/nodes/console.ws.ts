// @ts-nocheck — bundled by Nitro (which resolves `h3`); excluded from tsc.
import { defineWebSocketHandler } from "h3";
import { consoleRelayHooks } from "./console-relay";

/**
 * The browser-facing console relay endpoint (`/api/servers/:id/console`).
 * Registered as a Nitro handler in vite.config.ts (features.websocket) — the
 * browser opens this with its session cookie and the panel relays the box's
 * logs + stats down from the daemon link.
 */
export default defineWebSocketHandler(consoleRelayHooks);
