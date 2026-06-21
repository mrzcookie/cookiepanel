import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateManagement } from "@/components/templates/template-management";
import { Button } from "@/components/ui/button";
import { templateToState } from "@/lib/domain/templates-editor";
import { adminTemplateEditQueryOptions } from "@/lib/templates-queries";
import { ADMIN_TEMPLATE_SCOPE } from "@/lib/templates-scope";

// Trailing underscore on `$templateId_` opts this route OUT of nesting under the
// detail route, so `/admin/templates/X/edit` renders the editor, not the detail.
export const Route = createFileRoute("/admin/templates/$templateId_/edit")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			adminTemplateEditQueryOptions(params.templateId)
		),
	component: AdminEditTemplate,
});

function AdminEditTemplate() {
	const { templateId } = Route.useParams();
	// The edit view resolves only for an official template (raw images included);
	// a missing or org-owned id comes back null → the same friendly screen.
	const { data: template } = useSuspenseQuery(
		adminTemplateEditQueryOptions(templateId)
	);

	if (!template) {
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
