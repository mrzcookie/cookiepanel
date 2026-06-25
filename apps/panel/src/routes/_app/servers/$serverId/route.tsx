import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Play, RotateCw, Square } from "lucide-react";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { RouteTabs, routeTabClassName } from "@/components/shared/route-tabs";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ServerRow } from "@/lib/domain/servers";
import {
	DATABASE_BROWSER_LABEL,
	hasDatabaseBrowser,
} from "@/lib/domain/templates";
import {
	invalidateServers,
	restartServer,
	serverQueryOptions,
	startServer,
	stopServer,
} from "@/lib/server-queries";
import { serverStatus } from "@/lib/status";
import {
	templatesListQueryOptions,
	useTemplate,
} from "@/lib/templates-queries";

export const Route = createFileRoute("/_app/servers/$serverId")({
	// Warm the templates cache so the per-tab template reads (startup, database)
	// resolve without a flash.
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(templatesListQueryOptions()),
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
	const query = useQuery(serverQueryOptions(serverId));

	if (query.isPending) {
		return null;
	}
	if (!query.data) {
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

	return <ServerChrome server={query.data} />;
}

function PowerControls({ server }: { server: ServerRow }) {
	const { id, state } = server;
	const queryClient = useQueryClient();

	// Drive a power action, surface failures (an unreachable box, a stuck
	// container), and refresh every server feed afterward.
	async function act(run: () => Promise<unknown>, pending: string) {
		toast.message(pending);
		try {
			await run();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't reach the server."
			);
		} finally {
			await invalidateServers(queryClient);
		}
	}

	if (state === "running") {
		return (
			<>
				<Button
					onClick={() => act(() => restartServer(id), "Restarting the server…")}
					size="sm"
					variant="outline"
				>
					<RotateCw />
					Restart
				</Button>
				<Button
					onClick={() => act(() => stopServer(id), "Stopping the server…")}
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
				onClick={() => act(() => stopServer(id), "Stopping the server…")}
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
			onClick={() => act(() => startServer(id), "Starting the server…")}
			size="sm"
		>
			<Play />
			Start
		</Button>
	);
}

function ServerChrome({ server }: { server: ServerRow }) {
	const template = useTemplate(server.templateId);
	const showBrowser = template ? hasDatabaseBrowser(template.features) : false;

	return (
		<>
			<div className="space-y-4">
				<PageHeader
					actions={<PowerControls server={server} />}
					back={{ label: "Servers", to: "/servers" }}
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
					{showBrowser ? (
						<Link
							className={routeTabClassName}
							params={{ serverId: server.id }}
							to="/servers/$serverId/database"
						>
							{DATABASE_BROWSER_LABEL}
						</Link>
					) : null}
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
