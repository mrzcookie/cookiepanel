// Monaco is imported via deep ESM paths so only the editor core + the grammars
// we use get bundled (not the full package's language services + workers).
// Vite resolves these at runtime; TypeScript needs the types declared here.

declare module "monaco-editor/esm/vs/editor/editor.api" {
	export * from "monaco-editor";
}

// Side-effect grammar registration (no exports).
declare module "monaco-editor/esm/vs/basic-languages/shell/shell.contribution";

// Vite's worker import: `?worker` yields a Worker constructor as the default
// export. (The panel doesn't pull in `vite/client` ambient types globally.)
declare module "*?worker" {
	const WorkerFactory: new () => Worker;
	export default WorkerFactory;
}
