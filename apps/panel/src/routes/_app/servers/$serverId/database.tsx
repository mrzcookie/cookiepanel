import { createFileRoute } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { MongoBrowser } from "@/components/servers/database/mongo-browser";
import { RedisBrowser } from "@/components/servers/database/redis-browser";
import { SqlBrowser } from "@/components/servers/database/sql-browser";
import { EmptyState } from "@/components/shared/empty-state";
import { databaseEngine, hasDatabaseBrowser } from "@/lib/domain/templates";
import { useServer } from "@/lib/stores/servers-store";
import { useTemplate } from "@/lib/stores/templates-store";

export const Route = createFileRoute("/_app/servers/$serverId/database")({
	component: ServerDatabaseTab,
});

function ServerDatabaseTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const template = useTemplate(server?.templateId ?? "");

	if (!server) {
		return null;
	}
	if (!(template && hasDatabaseBrowser(template.features))) {
		return (
			<EmptyState
				description="Turn on the Browser add-on in this server's template to manage its database here."
				icon={Database}
				title="Browser isn't enabled"
			/>
		);
	}
	const engine = databaseEngine(template);
	if (engine === "redis") {
		return <RedisBrowser server={server} />;
	}
	if (engine === "mongo") {
		return <MongoBrowser server={server} />;
	}
	return <SqlBrowser server={server} />;
}
