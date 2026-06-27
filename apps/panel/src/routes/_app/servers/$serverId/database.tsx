import { createFileRoute } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { lazy, Suspense } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { databaseEngine, hasDatabaseBrowser } from "@/lib/domain/eggs";
import { useEgg } from "@/lib/eggs-queries";
import { useServer } from "@/lib/server-queries";

// The browsers are first-party (no heavy npm dep), but a Postgres server's tab
// shouldn't carry the Mongo and Redis browsers it will never render. Load only
// the one matching the egg's engine, each as its own async chunk.
const RedisBrowser = lazy(() =>
	import("@/components/servers/database/redis-browser").then((m) => ({
		default: m.RedisBrowser,
	}))
);
const MongoBrowser = lazy(() =>
	import("@/components/servers/database/mongo-browser").then((m) => ({
		default: m.MongoBrowser,
	}))
);
const SqlBrowser = lazy(() =>
	import("@/components/servers/database/sql-browser").then((m) => ({
		default: m.SqlBrowser,
	}))
);

export const Route = createFileRoute("/_app/servers/$serverId/database")({
	component: ServerDatabaseTab,
});

function ServerDatabaseTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const egg = useEgg(server?.eggId ?? "");

	if (!server) {
		return null;
	}
	if (!(egg && hasDatabaseBrowser(egg.features))) {
		return (
			<EmptyState
				description="Turn on the Browser add-on in this server's egg to manage its database here."
				icon={Database}
				title="Browser isn't enabled"
			/>
		);
	}

	// Hand the browser only the connection fields as primitives — not the whole
	// `server`, which the 15s detail poll re-creates — so an open browser doesn't
	// re-render on a poll unless one of these values actually changes.
	const engine = databaseEngine(egg);
	return (
		<Suspense fallback={<BrowserFallback />}>
			{engine === "redis" ? (
				<RedisBrowser
					eggName={server.eggName}
					nodeAddress={server.nodeAddress}
					port={server.port}
					serverId={server.id}
					state={server.state}
				/>
			) : engine === "mongo" ? (
				<MongoBrowser
					eggName={server.eggName}
					nodeAddress={server.nodeAddress}
					port={server.port}
					serverId={server.id}
					state={server.state}
				/>
			) : (
				<SqlBrowser
					eggName={server.eggName}
					nodeAddress={server.nodeAddress}
					port={server.port}
					serverId={server.id}
					state={server.state}
				/>
			)}
		</Suspense>
	);
}

function BrowserFallback() {
	return <div className="h-96 rounded-xl border bg-muted/20" />;
}
