import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ChevronLeft, Play, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/error-screen";
import { PageHeader } from "@/components/page-header";
import { RouteTabs, routeTabClassName } from "@/components/route-tabs";
import { StatusIndicator } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	restartServer,
	startServer,
	stopServer,
	useServer,
} from "@/lib/servers-store";
import { serverStatus } from "@/lib/status";
import type { ServerRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/servers/$serverId")({
	component: ServerDetailLayout,
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/servers">Back to servers</Link>
				</Button>
			}
			className="min-h-[60vh]"
			code="404"
			description="That section doesn't exist. Pick a tab above, or head back."
			title="Page not found"
			tone="muted"
		/>
	),
});

function ServerDetailLayout() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);

	if (!server) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/servers">Back to servers</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Server not found"
				tone="muted"
			/>
		);
	}

	return <ServerChrome server={server} />;
}

function PowerControls({ server }: { server: ServerRow }) {
	const { id, state } = server;

	if (state === "running") {
		return (
			<>
				<Button
					onClick={() => {
						restartServer(id);
						toast.success("Restarting the server…");
					}}
					size="sm"
					variant="outline"
				>
					<RotateCw />
					Restart
				</Button>
				<Button
					onClick={() => {
						stopServer(id);
						toast.success("Stopping the server…");
					}}
					size="sm"
					variant="outline"
				>
					<Square />
					Stop
				</Button>
			</>
		);
	}

	if (state === "starting") {
		return (
			<Button
				onClick={() => {
					stopServer(id);
					toast.success("Stopping the server…");
				}}
				size="sm"
				variant="outline"
			>
				<Square />
				Stop
			</Button>
		);
	}

	if (state === "installing") {
		return (
			<Button disabled size="sm" variant="outline">
				Installing…
			</Button>
		);
	}

	// stopped | failed
	return (
		<Button
			onClick={() => {
				startServer(id);
				toast.success("Starting the server…");
			}}
			size="sm"
		>
			<Play />
			Start
		</Button>
	);
}

function ServerChrome({ server }: { server: ServerRow }) {
	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
				to="/servers"
			>
				<ChevronLeft className="size-4" />
				Servers
			</Link>

			<div className="space-y-4">
				<PageHeader
					actions={<PowerControls server={server} />}
					border={false}
					description={`${server.templateName} · ${server.nodeName}`}
					title={
						<span className="flex items-center gap-2.5">
							{server.name}
							<StatusIndicator status={serverStatus(server.state)} />
							{server.updateAvailable ? (
								<Badge variant="secondary">Update</Badge>
							) : null}
						</span>
					}
				/>
				<RouteTabs label="Server sections">
					<Link
						activeOptions={{ exact: true }}
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId"
					>
						Console
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/files"
					>
						Files
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/startup"
					>
						Startup
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/network"
					>
						Network
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/schedules"
					>
						Schedules
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/backups"
					>
						Backups
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/activity"
					>
						Activity
					</Link>
					<Link
						className={routeTabClassName}
						params={{ serverId: server.id }}
						to="/servers/$serverId/settings"
					>
						Settings
					</Link>
				</RouteTabs>
			</div>

			<Outlet />
		</>
	);
}
