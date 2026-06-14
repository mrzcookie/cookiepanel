import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { emptyEditorState } from "@/components/templates/editor-types";
import { TemplateEditor } from "@/components/templates/template-editor";

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

			<TemplateEditor initial={emptyEditorState()} mode="create" />
		</>
	);
}
