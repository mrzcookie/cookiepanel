import { createFileRoute } from "@tanstack/react-router";
import { EggEditor } from "@/components/eggs/egg-editor";
import { PageHeader } from "@/components/shared/page-header";
import { emptyEditorState } from "@/lib/domain/eggs-editor";
import { ADMIN_EGG_SCOPE } from "@/lib/eggs-scope";

export const Route = createFileRoute("/admin/eggs/new")({
	component: AdminNewEgg,
});

function AdminNewEgg() {
	return (
		<>
			<PageHeader
				back={{ label: "Eggs", to: "/admin/eggs" }}
				description="Build an official egg from scratch. Publish it when it's ready."
				title="New egg"
			/>

			<EggEditor
				initial={emptyEditorState()}
				mode="create"
				scope={ADMIN_EGG_SCOPE}
			/>
		</>
	);
}
