import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateEditor } from "@/components/templates/template-editor";
import { emptyEditorState } from "@/lib/domain/templates-editor";
import { ORG_TEMPLATE_SCOPE } from "@/lib/templates-scope";

export const Route = createFileRoute("/_app/templates_/new")({
	component: NewTemplate,
});

function NewTemplate() {
	return (
		<>
			<PageHeader
				back={{ label: "Templates", to: "/templates" }}
				description="Build a deployable recipe from scratch. Publish it when it's ready."
				title="New template"
			/>

			<TemplateEditor
				initial={emptyEditorState()}
				mode="create"
				scope={ORG_TEMPLATE_SCOPE}
			/>
		</>
	);
}
