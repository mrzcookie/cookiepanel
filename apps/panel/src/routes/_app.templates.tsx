import { createFileRoute } from "@tanstack/react-router";
import { LayoutTemplate } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_app/templates")({
	component: Templates,
});

function Templates() {
	return (
		<>
			<PageHeader
				title="Templates"
				description="Reusable recipes for deploying servers."
			/>
			<EmptyState
				icon={LayoutTemplate}
				title="No templates yet"
				description="Create or import a template to deploy servers from it."
			/>
		</>
	);
}
