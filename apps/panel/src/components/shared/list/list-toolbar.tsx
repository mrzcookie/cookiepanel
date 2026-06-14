import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { ViewToggle } from "@/components/shared/list/view-toggle";
import { Input } from "@/components/ui/input";
import { pluralize } from "@/lib/format";
import type { ListView } from "@/lib/list-view";

// The row under the page header: search (left), optional inline filters, live
// result count + view toggle (right). Wraps gracefully on narrow widths. `noun`
// is singular ("node").
export function ListToolbar({
	count,
	filters,
	noun,
	onQueryChange,
	onViewChange,
	query,
	view,
}: {
	count: number;
	/** Inline filter controls (e.g. category chips), shown next to the search. */
	filters?: ReactNode;
	noun: string;
	onQueryChange: (value: string) => void;
	onViewChange: (view: ListView) => void;
	query: string;
	view: ListView;
}) {
	const label = `Search ${noun}s`;
	return (
		<div className="flex flex-wrap items-center gap-3">
			<div className="relative w-full sm:max-w-xs">
				<Search
					aria-hidden
					className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground"
				/>
				<Input
					aria-label={label}
					className="pl-8"
					onChange={(event) => onQueryChange(event.target.value)}
					placeholder={`${label}…`}
					type="search"
					value={query}
				/>
			</div>
			{filters}
			<p
				aria-live="polite"
				className="ml-auto font-mono text-muted-foreground text-sm tabular-nums"
			>
				{pluralize(count, noun)}
			</p>
			<ViewToggle onChange={onViewChange} value={view} />
		</div>
	);
}
