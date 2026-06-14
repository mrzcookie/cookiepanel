import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateManagement } from "@/components/templates/template-management";
import { Button } from "@/components/ui/button";
import { isEditable } from "@/lib/domain/templates";
import { templateToState } from "@/lib/domain/templates-editor";
import { useTemplate } from "@/lib/stores/templates-store";

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
			<PageHeader
				back={{
					label: template.name,
					params: { templateId: template.id },
					to: "/templates/$templateId",
				}}
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
