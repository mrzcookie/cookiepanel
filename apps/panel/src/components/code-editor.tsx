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
// touches Monaco. Custom "console" themes (defineTheme below) match the app's
// cool-ink palette, including the suggest / find / context-menu widgets.
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
	// "The Console" editor themes: cool-ink surface, azure + semantic syntax,
	// matching the app palette (see DESIGN.md / global.css).
	monaco.editor.defineTheme("console-dark", {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "", foreground: "dfe3ea" },
			{ token: "comment", foreground: "5b6472", fontStyle: "italic" },
			{ token: "string", foreground: "7ee6a8" },
			{ token: "keyword", foreground: "82bdf8" },
			{ token: "number", foreground: "ffd166" },
			{ token: "type", foreground: "82d8f2" },
			{ token: "key", foreground: "82bdf8" },
			{ token: "delimiter", foreground: "9aa3b2" },
		],
		colors: {
			"editor.background": "#0a0c11",
			"editor.foreground": "#dfe3ea",
			"editorLineNumber.foreground": "#454b57",
			"editorLineNumber.activeForeground": "#8a93a3",
			"editor.selectionBackground": "#21456e",
			"editor.lineHighlightBackground": "#12151c",
			"editorCursor.foreground": "#5aa6f0",
			"editorIndentGuide.background1": "#1c2129",
			focusBorder: "#5aa6f0",
			"editorWidget.background": "#161922",
			"editorWidget.foreground": "#dfe3ea",
			"editorWidget.border": "#2a313c",
			"editorWidget.resizeBorder": "#5aa6f0",
			"editorSuggestWidget.background": "#161922",
			"editorSuggestWidget.border": "#2a313c",
			"editorSuggestWidget.foreground": "#dfe3ea",
			"editorSuggestWidget.selectedBackground": "#21456e",
			"editorSuggestWidget.highlightForeground": "#82bdf8",
			"editorHoverWidget.background": "#161922",
			"editorHoverWidget.border": "#2a313c",
			"input.background": "#0e1117",
			"input.foreground": "#dfe3ea",
			"input.border": "#2a313c",
			"inputOption.activeBorder": "#5aa6f0",
			"dropdown.background": "#161922",
			"dropdown.foreground": "#dfe3ea",
			"dropdown.border": "#2a313c",
			"list.hoverBackground": "#1c212b",
			"list.focusBackground": "#21456e",
			"list.activeSelectionBackground": "#21456e",
			"list.inactiveSelectionBackground": "#1c212b",
			"list.highlightForeground": "#82bdf8",
			"menu.background": "#161922",
			"menu.foreground": "#dfe3ea",
			"menu.border": "#2a313c",
			"menu.selectionBackground": "#21456e",
			"quickInput.background": "#161922",
			"quickInput.foreground": "#dfe3ea",
			"pickerGroup.foreground": "#82bdf8",
			"scrollbarSlider.background": "#2a313c66",
			"scrollbarSlider.hoverBackground": "#3a414d88",
			"scrollbarSlider.activeBackground": "#3a414daa",
		},
	});
	monaco.editor.defineTheme("console-light", {
		base: "vs",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "6b7280", fontStyle: "italic" },
			{ token: "string", foreground: "1f7a4d" },
			{ token: "keyword", foreground: "1f5fb0" },
			{ token: "number", foreground: "9a6b00" },
			{ token: "type", foreground: "0e6e8c" },
		],
		colors: {
			"editor.background": "#f3f4f7",
			"editor.foreground": "#1f242e",
			"editorLineNumber.foreground": "#9aa1ad",
			"editor.selectionBackground": "#c7dbf5",
			"editor.lineHighlightBackground": "#e9ebf0",
			"editorCursor.foreground": "#2c6fc7",
			focusBorder: "#2c6fc7",
			"editorWidget.background": "#ffffff",
			"editorWidget.foreground": "#1f242e",
			"editorWidget.border": "#d4d8e0",
			"editorSuggestWidget.background": "#ffffff",
			"editorSuggestWidget.border": "#d4d8e0",
			"editorSuggestWidget.foreground": "#1f242e",
			"editorSuggestWidget.selectedBackground": "#c7dbf5",
			"editorSuggestWidget.highlightForeground": "#1f5fb0",
			"editorHoverWidget.background": "#ffffff",
			"editorHoverWidget.border": "#d4d8e0",
			"input.background": "#ffffff",
			"input.foreground": "#1f242e",
			"input.border": "#d4d8e0",
			"dropdown.background": "#ffffff",
			"dropdown.foreground": "#1f242e",
			"dropdown.border": "#d4d8e0",
			"list.hoverBackground": "#eef1f6",
			"list.focusBackground": "#c7dbf5",
			"list.activeSelectionBackground": "#c7dbf5",
			"list.highlightForeground": "#1f5fb0",
			"menu.background": "#ffffff",
			"menu.foreground": "#1f242e",
			"menu.selectionBackground": "#c7dbf5",
		},
	});
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
					theme={resolvedTheme === "dark" ? "console-dark" : "console-light"}
					value={value}
				/>
			</Suspense>
		</div>
	);
}
