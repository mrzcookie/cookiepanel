import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

// `ANALYZE=true bun run build` (bun run analyze) writes a gzip treemap to
// .analyze/bundle.html so heavy deps (Monaco, xterm, recharts) can be confirmed
// to stay in their own chunks, out of the initial load.
const analyze = process.env.ANALYZE === "true";

/** Absolute path to a Nitro WebSocket handler file (resolved from this config). */
const wsHandler = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const config = defineConfig({
	plugins: [
		devtools(),
		// `bun` preset: build a Bun-optimized server (the panel is hosted as a
		// long-lived Bun container, not on Vercel). Run it with
		// `bun run .output/server/index.mjs`.
		//
		// features.websocket wires crossws onto the Bun server so the daemon dials
		// IN over a WebSocket and browsers reach the console relay. The two routes
		// are registered as raw Nitro handlers (TanStack Start's file routes don't
		// model WS upgrades); each exports a defineWebSocketHandler.
		nitro({
			preset: "bun",
			features: { websocket: true },
			handlers: [
				{
					route: "/api/daemon/v1/link",
					handler: wsHandler("./src/server/nodes/link.ws.ts"),
				},
				{
					route: "/api/servers/:id/console",
					handler: wsHandler("./src/server/nodes/console.ws.ts"),
				},
			],
		}),
		tailwindcss(),
		tanstackStart(),
		react(),
		babel({
			presets: [reactCompilerPreset()],
		}),
		analyze &&
			visualizer({
				filename: ".analyze/bundle.html",
				gzipSize: true,
				template: "treemap",
			}),
	],
	resolve: { tsconfigPaths: true },
	server: {
		port: 3000,
	},
});

export default config;
