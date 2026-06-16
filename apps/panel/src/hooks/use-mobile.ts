import { useCallback, useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

// Returns true when the viewport is narrower than `breakpoint`.
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT): boolean {
	const query = `(max-width: ${breakpoint - 1}px)`;

	const subscribe = useCallback(
		(onChange: () => void) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		[query]
	);

	const getSnapshot = useCallback(
		() => window.matchMedia(query).matches,
		[query]
	);

	// No viewport on the server, so default to desktop.
	const getServerSnapshot = () => false;

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
