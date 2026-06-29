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

const config = defineConfig({
	plugins: [
		devtools(),
		// `bun` preset: build a Bun-optimized server (the panel is hosted as a
		// long-lived Bun container, not on Vercel). Run it with
		// `bun run .output/server/index.mjs`.
		nitro({ preset: "bun" }),
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
