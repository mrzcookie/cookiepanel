import { createFileRoute } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { EntityCard, EntityIdentity } from "@/components/entity-card";
import { ListPage } from "@/components/list-page";
import { StatusIndicator } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { pluralize } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { templateStatus } from "@/lib/status";
import { TEMPLATES, type TemplateRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/templates")({
	component: Templates,
});

const STATUS_RANK: Record<TemplateRow["status"], number> = {
	published: 0,
	draft: 1,
	archived: 2,
};

// Curated library first: official, then by lifecycle, then alphabetical.
const SORTED_TEMPLATES = [...TEMPLATES].sort(
	(a, b) =>
		Number(b.official) - Number(a.official) ||
		STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
		a.name.localeCompare(b.name)
);

function Templates() {
	const [view, setView] = useListView("templates");

	return (
		<ListPage
			createLabel="New template"
			description="Reusable recipes for deploying servers."
			emptyDescription="Create or import a template to deploy servers from it."
			emptyTitle="No templates yet"
			filter={(template, q) =>
				template.name.toLowerCase().includes(q) ||
				template.category.toLowerCase().includes(q) ||
				template.summary.toLowerCase().includes(q)
			}
			icon={LayoutTemplate}
			items={SORTED_TEMPLATES}
			noun="template"
			onViewChange={setView}
			renderCard={(template) => (
				<TemplateCard key={template.id} template={template} />
			)}
			renderTable={(templates) => <TemplatesTable templates={templates} />}
			title="Templates"
			view={view}
		/>
	);
}

function OfficialBadge() {
	return <Badge variant="secondary">Official</Badge>;
}

function usageLabel(count: number) {
	return count === 0 ? "Unused" : pluralize(count, "server");
}

function capitalize(value: string) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function TemplateCard({ template }: { template: TemplateRow }) {
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
			title={template.name}
		>
			<p className="line-clamp-2 text-muted-foreground text-sm">
				{template.summary}
			</p>
		</EntityCard>
	);
}

function TemplatesTable({ templates }: { templates: TemplateRow[] }) {
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
								title={template.name}
							/>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{capitalize(template.origin)}
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
