import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateManagement } from "@/components/templates/template-management";
import { Button } from "@/components/ui/button";
import { templateToState } from "@/lib/domain/templates-editor";
import { useTemplate } from "@/lib/stores/templates-store";
import { ADMIN_TEMPLATE_SCOPE } from "@/lib/templates-scope";

// Trailing underscore on `$templateId_` opts this route OUT of nesting under the
// detail route, so `/admin/templates/X/edit` renders the editor, not the detail.
export const Route = createFileRoute("/admin/templates/$templateId_/edit")({
	component: AdminEditTemplate,
});

function AdminEditTemplate() {
	const { templateId } = Route.useParams();
	const template = useTemplate(templateId);

	// Only official templates are editable here; anything else resolves to the
	// same friendly screen so the two are indistinguishable.
	if (!template?.official) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/admin/templates">Back to templates</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or it isn't an official template."
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
					to: "/admin/templates/$templateId",
				}}
				description="Edit this official template's recipe."
				title="Edit template"
			/>

			<TemplateEditor
				initial={templateToState(template)}
				mode="edit"
				scope={ADMIN_TEMPLATE_SCOPE}
				templateId={template.id}
			/>

			<div className="mt-8">
				<TemplateManagement scope={ADMIN_TEMPLATE_SCOPE} template={template} />
			</div>
		</>
	);
}
