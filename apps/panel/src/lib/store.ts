import { useCallback, useRef, useSyncExternalStore } from "react";

// Shared factory for the UI-first stub stores: a tiny useSyncExternalStore wrapper. The real data layer replaces these wholesale.

export type Store<T> = {
	/** The current snapshot. */
	get: () => T;
	/** Replace the snapshot and notify every subscriber. */
	set: (next: T) => void;
	/** Subscribe to the whole snapshot (a useSyncExternalStore hook). */
	use: () => T;
	/**
	 * Subscribe to a derived slice of the snapshot, re-rendering only when that
	 * slice changes (by `isEqual`, default `Object.is`). Lets a component depend
	 * on part of a store without re-rendering on every unrelated mutation.
	 */
	useWith: <S>(
		selector: (state: T) => S,
		isEqual?: (a: S, b: S) => boolean
	) => S;
};

export function createStore<T>(seed: T): Store<T> {
	let snapshot = seed;
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
	const get = () => snapshot;
	const set = (next: T) => {
		snapshot = next;
		for (const listener of listeners) {
			listener();
		}
	};
	const use = () => useSyncExternalStore(subscribe, get, get);

	// Selector subscription. `use-sync-external-store/shim/with-selector` isn't
	// resolvable in this workspace, so we memoize the selection ourselves: cache
	// the last selected value and only recompute (and return a new reference) when
	// the underlying snapshot changed and `isEqual` says the slice differs. This
	// keeps a stable reference across unrelated mutations, so React skips renders.
	const useWith = <S>(
		selector: (state: T) => S,
		isEqual: (a: S, b: S) => boolean = Object.is
	): S => {
		const last = useRef<{ source: T; value: S } | null>(null);
		const getSelection = useCallback(() => {
			const source = get();
			const prev = last.current;
			if (prev && prev.source === source) {
				return prev.value;
			}
			const value = selector(source);
			if (prev && isEqual(prev.value, value)) {
				// Keep the prior reference so consumers don't see a new object.
				last.current = { source, value: prev.value };
				return prev.value;
			}
			last.current = { source, value };
			return value;
		}, [selector, isEqual]);
		return useSyncExternalStore(subscribe, getSelection, getSelection);
	};

	return { get, set, use, useWith };
}
