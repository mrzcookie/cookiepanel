import { useTheme } from "next-themes";
import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Monaco is browser-only and heavy, so it's lazy-loaded and gated behind a
// client mount: on SSR (and first paint) we render a placeholder, and the real
// editor swaps in on the client. The chunk only loads when this component
// mounts (e.g. when a template's Install tab or a server file is opened).
//
// We bundle Monaco from node_modules instead of fetching it from a CDN: load
// the editor core + the shell grammar, wire MonacoEnvironment so the worker
// comes from our own bundle, then point @monaco-editor/react's loader at the
// bundled instance. All of this runs in this client-only chunk, so SSR never
// touches Monaco. Theming is left at Monaco's built-in light/dark for now.
const Monaco = lazy(async () => {
	// Import the editor CORE only (`editor.api`), not the full `monaco-editor`
	// package — the full package bundles the json/css/html/ts language services
	// and their workers. We register just the one grammar we use.
	const [reactMonaco, monaco] = await Promise.all([
		import("@monaco-editor/react"),
		import("monaco-editor/esm/vs/editor/editor.api"),
	]);
	// Shell syntax highlighting (covers bash/ash/sh).
	await import("monaco-editor/esm/vs/basic-languages/shell/shell.contribution");
	(
		self as unknown as {
			MonacoEnvironment: { getWorker(): Promise<Worker> };
		}
	).MonacoEnvironment = {
		async getWorker() {
			const Worker = (
				await import("monaco-editor/esm/vs/editor/editor.worker?worker")
			).default;
			return new Worker();
		},
	};
	reactMonaco.loader.config({ monaco });
	return { default: reactMonaco.default };
});

function Placeholder({ label }: { label: string }) {
	return (
		<div className="flex h-full items-center justify-center bg-muted/40 font-mono text-muted-foreground text-xs">
			{label}
		</div>
	);
}

export function CodeEditor({
	value,
	onChange,
	language = "shell",
	className,
	readOnly = false,
}: {
	value: string;
	onChange: (value: string) => void;
	language?: string;
	className?: string;
	readOnly?: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const box = cn(
		"h-[28rem] overflow-hidden rounded-lg border bg-card",
		className
	);

	if (!mounted) {
		return (
			<div className={box}>
				<Placeholder label="Loading editor…" />
			</div>
		);
	}

	return (
		<div className={box}>
			<Suspense fallback={<Placeholder label="Loading editor…" />}>
				<Monaco
					height="100%"
					language={language}
					onChange={(v) => onChange(v ?? "")}
					options={{
						readOnly,
						minimap: { enabled: false },
						fontSize: 13,
						fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
						fontLigatures: false,
						lineNumbers: "on",
						lineDecorationsWidth: 12,
						lineNumbersMinChars: 3,
						glyphMargin: false,
						folding: false,
						scrollBeyondLastLine: false,
						wordWrap: "on",
						tabSize: 2,
						automaticLayout: true,
						padding: { top: 12, bottom: 12 },
						renderLineHighlight: "none",
						smoothScrolling: true,
						scrollbar: {
							verticalScrollbarSize: 10,
							horizontalScrollbarSize: 10,
						},
						overviewRulerLanes: 0,
					}}
					theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
					value={value}
				/>
			</Suspense>
		</div>
	);
}
