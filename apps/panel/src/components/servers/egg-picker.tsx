import { Check, LayoutTemplate, Search, SearchX } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { EntityIconChip } from "@/components/shared/entity-card";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deployBlockers, type Egg, isDeployable } from "@/lib/domain/eggs";
import { pluralize } from "@/lib/format";
import { eggStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// Why a non-deployable egg can't be launched, in one plain line.
function blockedReason(egg: Egg): string {
	if (egg.status === "draft") {
		return "Still a draft";
	}
	if (egg.status === "archived") {
		return "Archived";
	}
	return deployBlockers(egg)[0] ?? "Not ready to deploy";
}

function footerNote(egg: Egg): string {
	if (!isDeployable(egg)) {
		return blockedReason(egg);
	}
	return egg.serverCount === 0
		? "Unused"
		: pluralize(egg.serverCount, "server");
}

// The step-1 egg picker: a searchable, category-filtered grid of selectable
// egg cards. Only deployable (published, unblocked) eggs can be picked;
// the rest show dimmed with the reason. A raw image string is never rendered —
// the runtime is chosen by friendly label later.
export function EggPicker({
	onSelect,
	selectedId,
	eggs,
}: {
	onSelect: (id: string) => void;
	selectedId: string | null;
	eggs: Egg[];
}) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("All");

	const categories = [
		"All",
		...Array.from(new Set(eggs.map((egg) => egg.category))).sort(),
	];

	const needle = query.trim().toLowerCase();
	const filtered = eggs
		.filter((egg) => category === "All" || egg.category === category)
		.filter(
			(egg) =>
				!needle ||
				egg.name.toLowerCase().includes(needle) ||
				egg.summary.toLowerCase().includes(needle) ||
				egg.category.toLowerCase().includes(needle)
		)
		.sort((a, b) => {
			const aDeployable = isDeployable(a);
			const bDeployable = isDeployable(b);
			if (aDeployable !== bDeployable) {
				return aDeployable ? -1 : 1;
			}
			if (a.official !== b.official) {
				return a.official ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<div className="relative sm:max-w-xs sm:flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						aria-label="Search eggs"
						className="pl-8"
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search eggs…"
						value={query}
					/>
				</div>
				<div className="flex flex-wrap gap-1.5">
					{categories.map((option) => (
						<Button
							aria-pressed={category === option}
							key={option}
							onClick={() => setCategory(option)}
							size="sm"
							variant={category === option ? "secondary" : "ghost"}
						>
							{option}
						</Button>
					))}
				</div>
			</div>

			{filtered.length === 0 ? (
				<EmptyState
					action={
						<Button
							onClick={() => {
								setQuery("");
								setCategory("All");
							}}
							size="sm"
							variant="outline"
						>
							Clear filters
						</Button>
					}
					description="Try a different word, or clear the filters."
					icon={SearchX}
					title="No eggs match"
				/>
			) : (
				<fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<legend className="sr-only">Egg</legend>
					{filtered.map((egg) => (
						<EggCard
							key={egg.id}
							onSelect={onSelect}
							selected={egg.id === selectedId}
							egg={egg}
						/>
					))}
				</fieldset>
			)}
		</div>
	);
}

function EggCard({
	onSelect,
	selected,
	egg,
}: {
	onSelect: (id: string) => void;
	selected: boolean;
	egg: Egg;
}) {
	const deployable = isDeployable(egg);
	const descriptionId = `tpl-${egg.id}-note`;
	return (
		<label
			className={cn(
				"flex flex-col gap-3 rounded-xl bg-card p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2",
				selected ? "ring-2 ring-primary" : "ring-1 ring-foreground/10",
				deployable
					? "cursor-pointer hover:bg-muted/40"
					: "cursor-not-allowed opacity-60"
			)}
		>
			<input
				aria-describedby={descriptionId}
				checked={selected}
				className="sr-only"
				disabled={!deployable}
				name="egg"
				onChange={() => onSelect(egg.id)}
				type="radio"
				value={egg.id}
			/>
			<div className="flex items-start gap-3">
				<EntityIconChip icon={LayoutTemplate} imageUrl={egg.iconUrl} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-heading font-medium text-base leading-snug">
							{egg.name}
						</span>
						{egg.official ? <Badge variant="secondary">Official</Badge> : null}
					</div>
					<div className="truncate font-mono text-[0.7rem] text-muted-foreground uppercase tracking-wide">
						{egg.category} · v{egg.version}
					</div>
				</div>
				{selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
			</div>
			<p className="line-clamp-2 min-h-9 text-muted-foreground text-sm">
				{egg.summary}
			</p>
			<div className="flex items-center justify-between gap-2 border-t pt-3">
				<StatusIndicator status={eggStatus(egg.status)} />
				<span className="text-muted-foreground text-xs" id={descriptionId}>
					{footerNote(egg)}
				</span>
			</div>
		</label>
	);
}
