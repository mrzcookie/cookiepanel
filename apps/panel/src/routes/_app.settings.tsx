import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RouteTabs, routeTabClassName } from "@/components/route-tabs";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<>
			<div className="space-y-4">
				<PageHeader
					border={false}
					description="Manage this organization and its members."
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
