import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { ErrorScreen } from "@/components/error-screen";
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
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/templates">Back to templates</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or it's an official template that's read-only."
				title="You can't edit that template"
				tone="muted"
			/>
		);
	}

	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
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
