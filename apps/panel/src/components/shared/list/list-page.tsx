import { type LucideIcon, Plus, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { ListToolbar } from "@/components/shared/list/list-toolbar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import type { ListView } from "@/lib/list-view";

// The shared list-page orchestrator. Owns the search query, runs the
// empty / no-results / grid / table branch, and renders identical chrome across
// the four fleet pages. The grid/list choice is owned by the route (URL) and
// passed in. `noun` is the singular form ("node"); the create flow is a later
// phase, so the CTA is a present affordance only.
export function ListPage<T>({
	action,
	createLabel,
	description,
	emptyDescription,
	emptyTitle,
	eyebrow,
	filter,
	filters,
	icon: Icon,
	items,
	noun,
	onCreate,
	onViewChange,
	renderCard,
	renderTable,
	title,
	view,
}: {
	/** Custom create control (e.g. a menu). Overrides the default button. */
	action?: ReactNode;
	createLabel: string;
	description: string;
	/** `// section` kicker for the page header. */
	eyebrow?: string;
	emptyDescription: string;
	emptyTitle: string;
	filter: (item: T, query: string) => boolean;
	/** Inline filter controls shown in the toolbar next to the search. */
	filters?: ReactNode;
	icon: LucideIcon;
	items: T[];
	noun: string;
	/** Run when the create CTA is clicked. Defaults to a "coming soon" toast. */
	onCreate?: () => void;
	onViewChange: (view: ListView) => void;
	/** Must set `key` on the returned element. */
	renderCard: (item: T) => ReactNode;
	renderTable: (items: T[]) => ReactNode;
	title: string;
	view: ListView;
}) {
	const [query, setQuery] = useState("");
	const trimmed = query.trim();
	const needle = trimmed.toLowerCase();
	const filtered = needle
		? items.filter((item) => filter(item, needle))
		: items;

	const cta = action ?? (
		<Button onClick={onCreate ?? (() => toast.info("Coming soon."))} size="sm">
			<Plus />
			{createLabel}
		</Button>
	);

	return (
		<>
			<PageHeader
				actions={cta}
				description={description}
				eyebrow={eyebrow}
				title={title}
			/>
			{items.length === 0 ? (
				<EmptyState
					action={cta}
					description={emptyDescription}
					icon={Icon}
					title={emptyTitle}
				/>
			) : (
				<>
					<ListToolbar
						count={filtered.length}
						filters={filters}
						noun={noun}
						onQueryChange={setQuery}
						onViewChange={onViewChange}
						query={query}
						view={view}
					/>
					{filtered.length === 0 ? (
						<EmptyState
							action={
								<Button
									onClick={() => setQuery("")}
									size="sm"
									variant="outline"
								>
									Clear search
								</Button>
							}
							description={`No ${noun}s match “${trimmed}”.`}
							icon={SearchX}
							title={`No matching ${noun}s`}
						/>
					) : view === "grid" ? (
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{filtered.map(renderCard)}
						</div>
					) : (
						<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
							{renderTable(filtered)}
						</div>
					)}
				</>
			)}
		</>
	);
}
