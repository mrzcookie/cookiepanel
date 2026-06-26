import { Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { type ReactNode, useState } from "react";
import { EntityCard, EntityIdentity } from "@/components/shared/entity-card";
import { ListPage } from "@/components/shared/list/list-page";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { EGG_CATEGORIES, type Egg, ORIGIN_LABELS } from "@/lib/domain/eggs";
import type { EggScope } from "@/lib/eggs-scope";
import { pluralize } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { eggStatus } from "@/lib/status";

const STATUS_RANK: Record<Egg["status"], number> = {
	published: 0,
	draft: 1,
	archived: 2,
};

// The eggs list — a grid/table of cards with a category filter and search.
// Shared by the org catalog (/eggs) and the admin official library
// (/admin/eggs); `scope` carries the per-surface differences (the detail
// link, whether the Official badge shows, the view-toggle key, and the copy).
export function EggCatalog({
	eggs,
	scope,
	action,
}: {
	eggs: Egg[];
	scope: EggScope;
	action: ReactNode;
}) {
	const [view, setView] = useListView(scope.viewKey);
	const [category, setCategory] = useState("All");

	// Curated library first: official, then by lifecycle, then alphabetical.
	const sorted = [...eggs].sort(
		(a, b) =>
			Number(b.official) - Number(a.official) ||
			STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
			a.name.localeCompare(b.name)
	);

	// Categories actually present in the catalog, in canonical order, after "All".
	const categories = [
		"All",
		...EGG_CATEGORIES.filter((option) =>
			eggs.some((egg) => egg.category === option)
		),
	];
	// Fall back to All if the active category emptied out (e.g. last one deleted).
	const active = categories.includes(category) ? category : "All";
	const visible =
		active === "All" ? sorted : sorted.filter((egg) => egg.category === active);

	return (
		<ListPage
			action={action}
			createLabel="New egg"
			description={scope.listDescription}
			emptyDescription={scope.emptyDescription}
			emptyTitle={scope.emptyTitle}
			eyebrow="library"
			filter={(egg, q) =>
				egg.name.toLowerCase().includes(q) ||
				egg.category.toLowerCase().includes(q) ||
				egg.summary.toLowerCase().includes(q)
			}
			filters={
				<CategoryFilter
					active={active}
					categories={categories}
					onChange={setCategory}
				/>
			}
			icon={LayoutTemplate}
			items={visible}
			noun="egg"
			onViewChange={setView}
			renderCard={(egg) => <EggCard key={egg.id} scope={scope} egg={egg} />}
			renderTable={(rows) => <EggsTable scope={scope} eggs={rows} />}
			title="Eggs"
			view={view}
		/>
	);
}

// Inline category chips for the list toolbar, mirroring the deploy egg
// picker: ghost by default, secondary when active.
function CategoryFilter({
	active,
	categories,
	onChange,
}: {
	active: string;
	categories: string[];
	onChange: (category: string) => void;
}) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{categories.map((option) => (
				<Button
					aria-pressed={active === option}
					key={option}
					onClick={() => onChange(option)}
					size="sm"
					variant={active === option ? "secondary" : "ghost"}
				>
					{option}
				</Button>
			))}
		</div>
	);
}

function usageLabel(count: number) {
	return count === 0 ? "Unused" : pluralize(count, "server");
}

// On a mixed surface (the org catalog) the Official badge marks platform
// eggs; on the admin library every egg is official, so it's omitted.
function officialBadge(scope: EggScope, egg: Egg) {
	return !scope.official && egg.official ? (
		<Badge variant="secondary">Official</Badge>
	) : null;
}

function EggLink({ scope, egg }: { scope: EggScope; egg: Egg }) {
	return (
		<Link
			className="hover:underline"
			params={{ eggId: egg.id } as never}
			to={scope.detailPath as never}
		>
			{egg.name}
		</Link>
	);
}

function EggCard({ scope, egg }: { scope: EggScope; egg: Egg }) {
	return (
		<EntityCard
			action={officialBadge(scope, egg)}
			footer={
				<>
					<span className="shrink-0">{usageLabel(egg.serverCount)}</span>
					{/* Published is the normal state — only flag the exceptions
					    (draft / archived) so the grid isn't a wall of "Published". */}
					{egg.status === "published" ? null : (
						<StatusIndicator status={eggStatus(egg.status)} />
					)}
				</>
			}
			icon={LayoutTemplate}
			imageUrl={egg.iconUrl}
			subtitle={`${egg.category} · v${egg.version}`}
			title={<EggLink scope={scope} egg={egg} />}
		>
			<p className="line-clamp-2 text-muted-foreground text-sm">
				{egg.summary}
			</p>
		</EntityCard>
	);
}

function EggsTable({ scope, eggs }: { scope: EggScope; eggs: Egg[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Egg</TableHead>
					<TableHead>Origin</TableHead>
					<TableHead className="text-right">Version</TableHead>
					<TableHead className="text-right">In use</TableHead>
					<TableHead className="text-right">Status</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{eggs.map((egg) => (
					<TableRow key={egg.id}>
						<TableCell>
							<EntityIdentity
								badge={officialBadge(scope, egg)}
								icon={LayoutTemplate}
								imageUrl={egg.iconUrl}
								subtitle={egg.category}
								title={<EggLink scope={scope} egg={egg} />}
							/>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{ORIGIN_LABELS[egg.origin]}
						</TableCell>
						<TableCell className="text-right font-mono text-muted-foreground text-xs">
							v{egg.version}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{egg.serverCount === 0 ? "—" : egg.serverCount}
						</TableCell>
						<TableCell className="text-right">
							<StatusIndicator status={eggStatus(egg.status)} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
