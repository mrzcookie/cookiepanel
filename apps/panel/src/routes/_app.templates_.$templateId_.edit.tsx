import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, LayoutTemplate } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { templateToState } from "@/components/templates/editor-types";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateManagement } from "@/components/templates/template-management";
import { Button } from "@/components/ui/button";
import { isEditable } from "@/lib/templates";
import { useTemplate } from "@/lib/templates-store";

// Trailing underscore on `$templateId_` opts this route OUT of nesting under the
// detail route, so `/templates/X/edit` renders the editor, not the detail page.
export const Route = createFileRoute("/_app/templates_/$templateId_/edit")({
	component: EditTemplate,
});

function EditTemplate() {
	const { templateId } = Route.useParams();
	const template = useTemplate(templateId);

	// Editing is owner-only; a missing or official (read-only) template resolves
	// to the same friendly screen so the two are indistinguishable.
	if (!template || !isEditable(template)) {
		return (
			<EmptyState
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/templates">Back to templates</Link>
					</Button>
				}
				description="It may have been removed, or it's an official template that's read-only."
				icon={LayoutTemplate}
				title="You can't edit that template"
			/>
		);
	}

	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
				params={{ templateId: template.id }}
				to="/templates/$templateId"
			>
				<ChevronLeft className="size-4" />
				{template.name}
			</Link>

			<PageHeader
				description="Edit this template's recipe."
				title="Edit template"
			/>

			<TemplateEditor
				initial={templateToState(template)}
				mode="edit"
				templateId={template.id}
			/>

			<div className="mt-8">
				<TemplateManagement template={template} />
			</div>
		</>
	);
}
