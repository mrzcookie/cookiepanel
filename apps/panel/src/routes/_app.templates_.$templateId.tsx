import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, FilePen, LayoutTemplate, Pencil } from "lucide-react";
import { ErrorScreen } from "@/components/layout/error-screen";
import { EntityIconChip } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { CustomizeButton } from "@/components/templates/customize-button";
import { UseTemplateDialog } from "@/components/templates/use-template-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	isDeployable,
	isEditable,
	knownFeatures,
	shownVariables,
	type Template,
} from "@/lib/domain/templates";
import { useTemplate } from "@/lib/stores/templates-store";

export const Route = createFileRoute("/_app/templates_/$templateId")({
	component: TemplateDetail,
});

function TemplateDetail() {
	const { templateId } = Route.useParams();
	const template = useTemplate(templateId);

	if (!template) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/templates">Back to templates</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Template not found"
				tone="muted"
			/>
		);
	}

	return <TemplateView template={template} />;
}

function TemplateView({ template }: { template: Template }) {
	const editable = isEditable(template);
	const deployable = isDeployable(template);

	return (
		<>
			<PageHeader
				actions={
					<>
						{editable ? (
							<Button asChild variant="outline">
								<Link
									params={{ templateId: template.id }}
									to="/templates/$templateId/edit"
								>
									<Pencil className="size-4" /> Edit
								</Link>
							</Button>
						) : (
							<CustomizeButton templateId={template.id} />
						)}
						{deployable ? <UseTemplateDialog template={template} /> : null}
					</>
				}
				back={{ label: "Templates", to: "/templates" }}
				description={`${template.category} · v${template.version}`}
				title={
					<span className="flex items-center gap-2.5">
						<EntityIconChip icon={LayoutTemplate} imageUrl={template.iconUrl} />
						{template.name}
						{template.official ? (
							<Badge variant="secondary">Official</Badge>
						) : null}
					</span>
				}
			/>

			<StatusNotice template={template} />

			{template.parentName ? (
				<p className="text-muted-foreground text-sm">
					Based on {template.parentName}
				</p>
			) : null}

			{template.summary ? (
				<p className="max-w-2xl text-foreground/90">{template.summary}</p>
			) : null}

			{template.description ? (
				<p className="max-w-2xl whitespace-pre-line text-muted-foreground text-sm">
					{template.description}
				</p>
			) : null}

			<Features template={template} />
			<Runtimes template={template} />
			<Variables template={template} />
		</>
	);
}

// A published template is the normal case and needs no callout. Draft and
// archived are the exceptions — surface them prominently and say what the state
// means for the reader, not just a badge tucked below everything.
function StatusNotice({ template }: { template: Template }) {
	if (template.status === "draft") {
		return (
			<div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-wash/40 p-4">
				<FilePen className="mt-0.5 size-5 shrink-0 text-warn" />
				<div className="space-y-1">
					<p className="font-medium text-sm">Draft — not published</p>
					<p className="text-muted-foreground text-sm">
						{isEditable(template)
							? "You can't deploy servers from this template yet. Finish setting it up and publish it from the editor to start launching servers."
							: "You can't deploy servers from this template until it's published."}
					</p>
				</div>
			</div>
		);
	}
	if (template.status === "archived") {
		return (
			<div className="flex items-start gap-3 rounded-lg border bg-muted/50 p-4">
				<Archive className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
				<div className="space-y-1">
					<p className="font-medium text-sm">Archived</p>
					<p className="text-muted-foreground text-sm">
						This template is hidden from the catalog and can't be used for new
						servers. Servers already deployed from it keep running.
					</p>
				</div>
			</div>
		);
	}
	return null;
}

function Features({ template }: { template: Template }) {
	const features = knownFeatures(template.features);
	if (features.length === 0) {
		return null;
	}
	return (
		<section className="space-y-3">
			<h2 className="font-medium text-base">Includes</h2>
			<div className="flex flex-wrap gap-2">
				{features.map((feature) => (
					<span
						className="rounded-md border bg-card px-2 py-1 text-sm"
						key={feature.key}
						title={feature.description}
					>
						{feature.label}
					</span>
				))}
			</div>
		</section>
	);
}

function Runtimes({ template }: { template: Template }) {
	if (template.images.length === 0) {
		return null;
	}
	return (
		<section className="space-y-3">
			<h2 className="font-medium text-base">Runtimes</h2>
			<div className="divide-y overflow-hidden rounded-lg border">
				{template.images.map((image) => (
					<div
						className="flex items-center justify-between gap-2 bg-card px-4 py-2.5"
						key={image.id}
					>
						<span className="text-sm">{image.label}</span>
						{image.isDefault ? (
							<Badge variant="secondary">Default</Badge>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}

function Variables({ template }: { template: Template }) {
	const shown = shownVariables(template);
	if (shown.length === 0) {
		return null;
	}
	return (
		<section className="space-y-3">
			<h2 className="font-medium text-base">Settings</h2>
			<div className="divide-y overflow-hidden rounded-lg border">
				{shown.map((variable) => (
					<div
						className="flex items-center gap-3 bg-card px-4 py-3"
						key={variable.id}
					>
						<div className="min-w-0 flex-1">
							<div className="font-medium text-sm">{variable.name}</div>
							{variable.description ? (
								<div className="truncate text-muted-foreground text-xs">
									{variable.description}
								</div>
							) : null}
						</div>
						<div className="shrink-0 font-mono text-muted-foreground text-xs">
							{variable.access === "secret"
								? "set per server"
								: (variable.defaultValue ?? "—")}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
