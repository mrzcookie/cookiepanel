import { useCallback, useEffect, useState } from "react";

// The grid/list choice for a fleet list page, persisted per page in
// localStorage (`view:<page>`) so each page reopens to how you left it. It's a
// personal preference, not something to share or bookmark, so it stays out of
// the URL.

export type ListView = "grid" | "list";

function isListView(value: unknown): value is ListView {
	return value === "grid" || value === "list";
}

export function useListView(
	page: string
): [ListView, (view: ListView) => void] {
	const storageKey = `view:${page}`;
	const [view, setView] = useState<ListView>("grid");

	// Read the saved choice on the client after mount. Starting from "grid" keeps
	// the server and first client render in agreement (no hydration mismatch).
	useEffect(() => {
		const saved = localStorage.getItem(storageKey);
		if (isListView(saved)) {
			setView(saved);
		}
	}, [storageKey]);

	const update = useCallback(
		(next: ListView) => {
			setView(next);
			localStorage.setItem(storageKey, next);
		},
		[storageKey]
	);

	return [view, update];
}
