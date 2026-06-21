import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { TemplateManagement } from "@/components/templates/template-management";
import { Button } from "@/components/ui/button";
import { templateToState } from "@/lib/domain/templates-editor";
import { templateEditQueryOptions } from "@/lib/templates-queries";
import { ORG_TEMPLATE_SCOPE } from "@/lib/templates-scope";

// Trailing underscore on `$templateId_` opts this route OUT of nesting under the
// detail route, so `/templates/X/edit` renders the editor, not the detail page.
export const Route = createFileRoute("/_app/templates_/$templateId_/edit")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			templateEditQueryOptions(params.templateId)
		),
	component: EditTemplate,
});

function EditTemplate() {
	const { templateId } = Route.useParams();
	// The edit view carries raw image strings and resolves only for a template
	// this org owns; a missing or official (read-only) one comes back null, and
	// resolves to the same friendly screen so the two are indistinguishable.
	const { data: template } = useSuspenseQuery(
		templateEditQueryOptions(templateId)
	);

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
				scope={ORG_TEMPLATE_SCOPE}
				templateId={template.id}
			/>

			<div className="mt-8">
				<TemplateManagement scope={ORG_TEMPLATE_SCOPE} template={template} />
			</div>
		</>
	);
}
