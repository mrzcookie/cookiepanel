import { createFileRoute } from "@tanstack/react-router";
import { CreateServerWizard } from "@/components/servers/create-server-wizard";

export const Route = createFileRoute("/_app/servers/new")({
	component: NewServer,
	validateSearch: (search: Record<string, unknown>): { template?: string } =>
		typeof search.template === "string" ? { template: search.template } : {},
});

function NewServer() {
	const { template } = Route.useSearch();
	return <CreateServerWizard preselectId={template} />;
}
