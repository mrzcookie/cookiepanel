import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ServerActivityCard } from "@/components/servers/server-activity";
import { ServerUsageCard } from "@/components/servers/server-usage";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ServerRow } from "@/lib/domain/servers";
import { useServer } from "@/lib/stores/servers-store";

// xterm touches the DOM at import, so the console only loads on the client.
const ServerConsole = lazy(() => import("@/components/servers/server-console"));

export const Route = createFileRoute("/_app/servers/$serverId/")({
	component: ServerConsoleTab,
});

function formatUptime(seconds: number | null) {
	if (seconds === null) {
		return "—";
	}
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

function ServerConsoleTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);

	if (!server) {
		return null;
	}

	return (
		<div className="space-y-6">
			{server.state === "failed" && server.lastError ? (
				<Card className="border-destructive/40">
					<CardHeader>
						<CardTitle className="text-base text-destructive">
							Setup failed
						</CardTitle>
					</CardHeader>
					<CardContent>
						<pre className="overflow-auto whitespace-pre-wrap font-mono text-destructive/90 text-xs">
							{server.lastError}
						</pre>
					</CardContent>
				</Card>
			) : null}

			<div className="grid gap-6 lg:grid-cols-3">
				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Console</CardTitle>
						<CardDescription>Live output from your server.</CardDescription>
					</CardHeader>
					<CardContent>
						<ClientOnly fallback={<ConsoleFallback />}>
							<Suspense fallback={<ConsoleFallback />}>
								<ServerConsole
									canSend={server.state === "running"}
									state={server.state}
									templateName={server.templateName}
								/>
							</Suspense>
						</ClientOnly>
					</CardContent>
				</Card>

				<div className="flex min-h-0 flex-col gap-6">
					<ConnectionCard server={server} />
					<ServerActivityCard className="min-h-0 flex-1" server={server} />
				</div>
			</div>

			<ServerUsageCard server={server} />
		</div>
	);
}

function ConsoleFallback() {
	return (
		<div className="space-y-3">
			<div className="flex h-96 items-center justify-center rounded-lg bg-terminal text-muted-foreground text-sm">
				Starting console…
			</div>
			<div className="h-9 rounded-md bg-muted/40" />
		</div>
	);
}

function ConnectionCard({ server }: { server: ServerRow }) {
	const connect =
		server.port === null ? null : `${server.nodeAddress}:${server.port}`;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Where players reach this server.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow
						copyable={Boolean(connect)}
						label="Connect"
						value={connect ?? "—"}
					/>
					<DetailRow
						label="Uptime"
						value={formatUptime(server.uptimeSeconds)}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}
