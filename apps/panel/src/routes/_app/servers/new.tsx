import { createFileRoute } from "@tanstack/react-router";
import { CreateServerWizard } from "@/components/servers/create-server-wizard";
import { templatesListQueryOptions } from "@/lib/templates-queries";

export const Route = createFileRoute("/_app/servers/new")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(templatesListQueryOptions()),
	component: NewServer,
	validateSearch: (search: Record<string, unknown>): { template?: string } =>
		typeof search.template === "string" ? { template: search.template } : {},
});

function NewServer() {
	const { template } = Route.useSearch();
	return <CreateServerWizard preselectId={template} />;
}
