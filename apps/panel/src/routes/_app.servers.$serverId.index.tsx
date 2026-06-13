import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { DetailList, DetailRow } from "@/components/detail-list";
import { UsageMeter } from "@/components/entity-card";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import { useServer } from "@/lib/servers-store";
import type { ServerRow } from "@/lib/stubs";

// xterm touches the DOM at import, so the console only loads on the client.
const ServerConsole = lazy(() => import("@/components/server-console"));

export const Route = createFileRoute("/_app/servers/$serverId/")({
	component: ServerConsoleTab,
});

function percent(used: number | null, total: number) {
	if (used === null || total === 0) {
		return null;
	}
	return Math.round((used / total) * 100);
}

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

			<div className="grid items-start gap-6 lg:grid-cols-3">
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

				<div className="space-y-6">
					<ConnectionCard server={server} />
					<ResourcesCard server={server} />
				</div>
			</div>
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
				<CardTitle>Connection</CardTitle>
				<CardDescription>Where players reach this server.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow
						copyable={Boolean(connect)}
						label="Connect"
						value={connect ?? "—"}
					/>
					<DetailRow label="Runtime" value={server.imageLabel} />
					<DetailRow
						label="Uptime"
						value={formatUptime(server.uptimeSeconds)}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}

function ResourcesCard({ server }: { server: ServerRow }) {
	const memPercent = percent(server.memUsedBytes, server.memLimitBytes);
	const diskPercent = percent(server.diskUsedBytes, server.diskLimitBytes);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Resources</CardTitle>
				<CardDescription>
					Live usage against this server's limits.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<UsageMeter
					detail={
						server.cpuPercent === null
							? `— / ${server.cpuLimitCores} cores`
							: `${server.cpuPercent}% of ${server.cpuLimitCores} cores`
					}
					label="CPU"
					stressed={(server.cpuPercent ?? 0) >= 90}
					value={server.cpuPercent}
				/>
				<UsageMeter
					detail={`${
						server.memUsedBytes === null
							? "—"
							: formatBytes(server.memUsedBytes)
					} / ${formatBytes(server.memLimitBytes)}`}
					label="Memory"
					stressed={(memPercent ?? 0) >= 90}
					value={memPercent}
				/>
				<UsageMeter
					detail={`${
						server.diskUsedBytes === null
							? "—"
							: formatBytes(server.diskUsedBytes)
					} / ${formatBytes(server.diskLimitBytes)}`}
					label="Disk"
					stressed={(diskPercent ?? 0) >= 90}
					value={diskPercent}
				/>
			</CardContent>
		</Card>
	);
}
