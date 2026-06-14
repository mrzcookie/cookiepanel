import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { useState } from "react";
import { EntityCard, EntityIdentity } from "@/components/shared/entity-card";
import { ListPage } from "@/components/shared/list/list-page";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { CreateTemplateMenu } from "@/components/templates/create-template-menu";
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
import { useTemplates } from "@/lib/stores/templates-store";

export const Route = createFileRoute("/_app/templates")({
	component: Templates,
});

const STATUS_RANK: Record<Template["status"], number> = {
	published: 0,
	draft: 1,
	archived: 2,
};

function Templates() {
	const [view, setView] = useListView("templates");
	const [category, setCategory] = useState("All");
	const templates = useTemplates();

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
			action={<CreateTemplateMenu />}
			createLabel="New template"
			description="Reusable recipes for deploying servers."
			emptyDescription="Create or import a template to deploy servers from it."
			eyebrow="library"
			emptyTitle="No templates yet"
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
				<TemplateCard key={template.id} template={template} />
			)}
			renderTable={(rows) => <TemplatesTable templates={rows} />}
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

function OfficialBadge() {
	return <Badge variant="secondary">Official</Badge>;
}

function usageLabel(count: number) {
	return count === 0 ? "Unused" : pluralize(count, "server");
}

function TemplateLink({ template }: { template: Template }) {
	return (
		<Link
			className="hover:underline"
			params={{ templateId: template.id }}
			to="/templates/$templateId"
		>
			{template.name}
		</Link>
	);
}

function TemplateCard({ template }: { template: Template }) {
	return (
		<EntityCard
			action={template.official ? <OfficialBadge /> : null}
			footer={
				<>
					<StatusIndicator status={templateStatus(template.status)} />
					<span className="shrink-0">{usageLabel(template.serverCount)}</span>
				</>
			}
			icon={LayoutTemplate}
			subtitle={`${template.category} · v${template.version}`}
			title={<TemplateLink template={template} />}
		>
			<p className="line-clamp-2 text-muted-foreground text-sm">
				{template.summary}
			</p>
		</EntityCard>
	);
}

function TemplatesTable({ templates }: { templates: Template[] }) {
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
								badge={template.official ? <OfficialBadge /> : null}
								icon={LayoutTemplate}
								subtitle={template.category}
								title={<TemplateLink template={template} />}
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
