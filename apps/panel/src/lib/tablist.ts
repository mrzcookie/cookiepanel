import type { KeyboardEvent } from "react";

// Implements the ARIA tabs keyboard contract for a custom `role="tablist"`:
// Arrow / Home / End move selection + focus across the tabs (automatic
// activation). Attach the returned handler to the tablist's `onKeyDown`, and
// give each tab `tabIndex={active ? 0 : -1}` (roving tabindex).
export function handleTablistKeys<T>(
	event: KeyboardEvent<HTMLElement>,
	values: readonly T[],
	current: T,
	onChange: (value: T) => void
) {
	const index = values.indexOf(current);
	if (index < 0) {
		return;
	}
	let next = -1;
	switch (event.key) {
		case "ArrowRight":
		case "ArrowDown":
			next = (index + 1) % values.length;
			break;
		case "ArrowLeft":
		case "ArrowUp":
			next = (index - 1 + values.length) % values.length;
			break;
		case "Home":
			next = 0;
			break;
		case "End":
			next = values.length - 1;
			break;
		default:
			return;
	}
	event.preventDefault();
	const target = values[next];
	if (target !== undefined) {
		onChange(target);
	}
	const tabs =
		event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
	tabs[next]?.focus();
}
