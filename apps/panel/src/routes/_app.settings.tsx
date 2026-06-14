import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { RouteTabs, routeTabClassName } from "@/components/shared/route-tabs";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsLayout,
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/settings">Back to settings</Link>
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

function SettingsLayout() {
	return (
		<>
			<div className="space-y-4">
				<PageHeader
					border={false}
					description="Manage this organization and its members."
					eyebrow="organization"
					title="Settings"
				/>
				<RouteTabs label="Settings sections">
					<Link
						activeOptions={{ exact: true }}
						className={routeTabClassName}
						to="/settings"
					>
						General
					</Link>
					<Link className={routeTabClassName} to="/settings/members">
						Members
					</Link>
					<Link className={routeTabClassName} to="/settings/activity">
						Activity
					</Link>
				</RouteTabs>
			</div>
			<Outlet />
		</>
	);
}
