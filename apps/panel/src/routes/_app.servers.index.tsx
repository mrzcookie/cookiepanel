import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Server } from "lucide-react";
import { CopyButton } from "@/components/shared/detail-list";
import {
	CardStat,
	EntityCard,
	EntityIdentity,
	UsageMeter,
} from "@/components/shared/entity-card";
import { ListPage } from "@/components/shared/list/list-page";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { ServerRow } from "@/lib/domain/servers";
import { formatBytes } from "@/lib/format";
import { useListView } from "@/lib/list-view";
import { serverStatus } from "@/lib/status";
import { useServers } from "@/lib/stores/servers-store";

export const Route = createFileRoute("/_app/servers/")({
	component: Servers,
});

function Servers() {
	const [view, setView] = useListView("servers");
	const servers = useServers();

	return (
		<ListPage
			action={
				<Button asChild size="sm">
					<Link to="/servers/new">
						<Plus />
						Deploy server
					</Link>
				</Button>
			}
			createLabel="Deploy server"
			description="Game and app instances you're running."
			eyebrow="fleet"
			emptyDescription="Servers you deploy from a template will appear here."
			emptyTitle="No servers yet"
			filter={(server, q) =>
				server.name.toLowerCase().includes(q) ||
				server.templateName.toLowerCase().includes(q) ||
				server.nodeName.toLowerCase().includes(q)
			}
			icon={Server}
			items={servers}
			noun="server"
			onViewChange={setView}
			renderCard={(server) => <ServerCard key={server.id} server={server} />}
			renderTable={(rows) => <ServersTable servers={rows} />}
			title="Servers"
			view={view}
		/>
	);
}

function connectString(server: ServerRow) {
	return server.port === null ? null : `${server.nodeAddress}:${server.port}`;
}

function memoryDetail(server: ServerRow) {
	const limit = formatBytes(server.memLimitBytes);
	return server.memUsedBytes === null
		? `— / ${limit}`
		: `${formatBytes(server.memUsedBytes)} / ${limit}`;
}

function ServerLink({ server }: { server: ServerRow }) {
	return (
		<Link
			className="hover:underline"
			params={{ serverId: server.id }}
			to="/servers/$serverId"
		>
			{server.name}
		</Link>
	);
}

function ServerCard({ server }: { server: ServerRow }) {
	const connect = connectString(server);
	const memPercent =
		server.memUsedBytes === null
			? null
			: Math.round((server.memUsedBytes / server.memLimitBytes) * 100);

	return (
		<EntityCard
			action={<StatusIndicator status={serverStatus(server.state)} />}
			icon={Server}
			subtitle={server.templateName}
			title={<ServerLink server={server} />}
			titleSuffix={
				server.updateAvailable ? (
					<Badge variant="secondary">Update</Badge>
				) : null
			}
		>
			<div className="flex flex-col gap-2.5">
				<CardStat label="Node" value={server.nodeName} />
				<div className="flex items-baseline justify-between gap-3">
					<span className="shrink-0 text-muted-foreground text-xs">
						Connect
					</span>
					{connect ? (
						<span className="flex min-w-0 items-center gap-1">
							<span className="min-w-0 flex-1 truncate font-mono text-xs">
								{connect}
							</span>
							<CopyButton label="connect address" value={connect} />
						</span>
					) : (
						<span className="text-sm">—</span>
					)}
				</div>
				<UsageMeter
					detail={server.cpuPercent === null ? "—" : `${server.cpuPercent}%`}
					label="CPU"
					stressed={(server.cpuPercent ?? 0) >= 90}
					value={server.cpuPercent}
				/>
				<UsageMeter
					detail={memoryDetail(server)}
					label="Memory"
					stressed={(memPercent ?? 0) >= 90}
					value={memPercent}
				/>
			</div>
		</EntityCard>
	);
}

function ServersTable({ servers }: { servers: ServerRow[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Server</TableHead>
					<TableHead>Template</TableHead>
					<TableHead>Node</TableHead>
					<TableHead>Connect</TableHead>
					<TableHead className="text-right">Status</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{servers.map((server) => {
					const connect = connectString(server);
					return (
						<TableRow key={server.id}>
							<TableCell>
								<EntityIdentity
									badge={
										server.updateAvailable ? (
											<Badge variant="secondary">Update</Badge>
										) : null
									}
									icon={Server}
									title={<ServerLink server={server} />}
								/>
							</TableCell>
							<TableCell className="text-muted-foreground">
								{server.templateName}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{server.nodeName}
							</TableCell>
							<TableCell className="font-mono text-muted-foreground text-xs">
								{connect ?? "—"}
							</TableCell>
							<TableCell className="text-right">
								<StatusIndicator status={serverStatus(server.state)} />
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
