import { createFileRoute } from "@tanstack/react-router";
import { EggEditor } from "@/components/eggs/egg-editor";
import { PageHeader } from "@/components/shared/page-header";
import { emptyEditorState } from "@/lib/domain/eggs-editor";
import { ORG_EGG_SCOPE } from "@/lib/eggs-scope";

export const Route = createFileRoute("/_app/eggs_/new")({
	component: NewEgg,
});

function NewEgg() {
	return (
		<>
			<PageHeader
				back={{ label: "Eggs", to: "/eggs" }}
				description="Build a deployable recipe from scratch. Publish it when it's ready."
				title="New egg"
			/>

			<EggEditor
				initial={emptyEditorState()}
				mode="create"
				scope={ORG_EGG_SCOPE}
			/>
		</>
	);
}
