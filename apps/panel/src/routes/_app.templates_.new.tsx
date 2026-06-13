import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { emptyEditorState } from "@/components/templates/editor-types";
import { TemplateEditor } from "@/components/templates/template-editor";

export const Route = createFileRoute("/_app/templates_/new")({
	component: NewTemplate,
});

function NewTemplate() {
	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
				to="/templates"
			>
				<ChevronLeft className="size-4" />
				Templates
			</Link>

			<PageHeader
				description="Build a deployable recipe from scratch. Publish it when it's ready."
				title="New template"
			/>

			<TemplateEditor initial={emptyEditorState()} mode="create" />
		</>
	);
}
