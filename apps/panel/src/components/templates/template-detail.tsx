import { Archive, FilePen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
	knownFeatures,
	shownVariables,
	type Template,
} from "@/lib/domain/templates";

// The read-only body of a template detail page — status notice, lineage, copy,
// features, runtimes, and settings. Shared by the org detail (/templates/$id)
// and the admin official detail (/admin/templates/$id); each route supplies its
// own PageHeader + actions. `canEdit` only tunes the draft-notice wording (an
// editor of the template gets a "publish it from the editor" nudge).
export function TemplateDetailBody({
	template,
	canEdit,
}: {
	template: Template;
	canEdit: boolean;
}) {
	return (
		<>
			<StatusNotice canEdit={canEdit} template={template} />

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
function StatusNotice({
	template,
	canEdit,
}: {
	template: Template;
	canEdit: boolean;
}) {
	if (template.status === "draft") {
		return (
			<div className="flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-wash/40 p-4">
				<FilePen className="mt-0.5 size-5 shrink-0 text-warn" />
				<div className="space-y-1">
					<p className="font-medium text-sm">Draft — not published</p>
					<p className="text-muted-foreground text-sm">
						{canEdit
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
