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
import {
	ORIGIN_LABELS,
	TEMPLATE_CATEGORIES,
	type Template,
} from "@/lib/domain/templates";
import { pluralize } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { templateStatus } from "@/lib/status";
import type { TemplateScope } from "@/lib/templates-scope";

const STATUS_RANK: Record<Template["status"], number> = {
	published: 0,
	draft: 1,
	archived: 2,
};

// The templates list — a grid/table of cards with a category filter and search.
// Shared by the org catalog (/templates) and the admin official library
// (/admin/templates); `scope` carries the per-surface differences (the detail
// link, whether the Official badge shows, the view-toggle key, and the copy).
export function TemplateCatalog({
	templates,
	scope,
	action,
}: {
	templates: Template[];
	scope: TemplateScope;
	action: ReactNode;
}) {
	const [view, setView] = useListView(scope.viewKey);
	const [category, setCategory] = useState("All");

	// Curated library first: official, then by lifecycle, then alphabetical.
	const sorted = [...templates].sort(
		(a, b) =>
			Number(b.official) - Number(a.official) ||
			STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
			a.name.localeCompare(b.name)
	);

	// Categories actually present in the catalog, in canonical order, after "All".
	const categories = [
		"All",
		...TEMPLATE_CATEGORIES.filter((option) =>
			templates.some((template) => template.category === option)
		),
	];
	// Fall back to All if the active category emptied out (e.g. last one deleted).
	const active = categories.includes(category) ? category : "All";
	const visible =
		active === "All"
			? sorted
			: sorted.filter((template) => template.category === active);

	return (
		<ListPage
			action={action}
			createLabel="New template"
			description={scope.listDescription}
			emptyDescription={scope.emptyDescription}
			emptyTitle={scope.emptyTitle}
			eyebrow="library"
			filter={(template, q) =>
				template.name.toLowerCase().includes(q) ||
				template.category.toLowerCase().includes(q) ||
				template.summary.toLowerCase().includes(q)
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
			noun="template"
			onViewChange={setView}
			renderCard={(template) => (
				<TemplateCard key={template.id} scope={scope} template={template} />
			)}
			renderTable={(rows) => <TemplatesTable scope={scope} templates={rows} />}
			title="Templates"
			view={view}
		/>
	);
}

// Inline category chips for the list toolbar, mirroring the deploy template
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
// templates; on the admin library every template is official, so it's omitted.
function officialBadge(scope: TemplateScope, template: Template) {
	return !scope.official && template.official ? (
		<Badge variant="secondary">Official</Badge>
	) : null;
}

function TemplateLink({
	scope,
	template,
}: {
	scope: TemplateScope;
	template: Template;
}) {
	return (
		<Link
			className="hover:underline"
			params={{ templateId: template.id } as never}
			to={scope.detailPath as never}
		>
			{template.name}
		</Link>
	);
}

function TemplateCard({
	scope,
	template,
}: {
	scope: TemplateScope;
	template: Template;
}) {
	return (
		<EntityCard
			action={officialBadge(scope, template)}
			footer={
				<>
					<span className="shrink-0">{usageLabel(template.serverCount)}</span>
					{/* Published is the normal state — only flag the exceptions
					    (draft / archived) so the grid isn't a wall of "Published". */}
					{template.status === "published" ? null : (
						<StatusIndicator status={templateStatus(template.status)} />
					)}
				</>
			}
			icon={LayoutTemplate}
			imageUrl={template.iconUrl}
			subtitle={`${template.category} · v${template.version}`}
			title={<TemplateLink scope={scope} template={template} />}
		>
			<p className="line-clamp-2 text-muted-foreground text-sm">
				{template.summary}
			</p>
		</EntityCard>
	);
}

function TemplatesTable({
	scope,
	templates,
}: {
	scope: TemplateScope;
	templates: Template[];
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Template</TableHead>
					<TableHead>Origin</TableHead>
					<TableHead className="text-right">Version</TableHead>
					<TableHead className="text-right">In use</TableHead>
					<TableHead className="text-right">Status</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{templates.map((template) => (
					<TableRow key={template.id}>
						<TableCell>
							<EntityIdentity
								badge={officialBadge(scope, template)}
								icon={LayoutTemplate}
								imageUrl={template.iconUrl}
								subtitle={template.category}
								title={<TemplateLink scope={scope} template={template} />}
							/>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{ORIGIN_LABELS[template.origin]}
						</TableCell>
						<TableCell className="text-right font-mono text-muted-foreground text-xs">
							v{template.version}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{template.serverCount === 0 ? "—" : template.serverCount}
						</TableCell>
						<TableCell className="text-right">
							<StatusIndicator status={templateStatus(template.status)} />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
