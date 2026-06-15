import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { emptyEditorState } from "@/lib/domain/templates-editor";
import { ADMIN_TEMPLATE_SCOPE } from "@/lib/templates-scope";

export const Route = createFileRoute("/admin/templates/new")({
	component: AdminNewTemplate,
});

function AdminNewTemplate() {
	return (
		<>
			<PageHeader
				back={{ label: "Templates", to: "/admin/templates" }}
				description="Build an official template from scratch. Publish it when it's ready."
				title="New template"
			/>

			<TemplateEditor
				initial={emptyEditorState()}
				mode="create"
				scope={ADMIN_TEMPLATE_SCOPE}
			/>
		</>
	);
}
