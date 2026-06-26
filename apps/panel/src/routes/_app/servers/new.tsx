import { createFileRoute } from "@tanstack/react-router";
import { CreateServerWizard } from "@/components/servers/create-server-wizard";
import { eggsListQueryOptions } from "@/lib/eggs-queries";

export const Route = createFileRoute("/_app/servers/new")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(eggsListQueryOptions()),
	component: NewServer,
	validateSearch: (search: Record<string, unknown>): { egg?: string } =>
		typeof search.egg === "string" ? { egg: search.egg } : {},
});

function NewServer() {
	const { egg } = Route.useSearch();
	return <CreateServerWizard preselectId={egg} />;
}
