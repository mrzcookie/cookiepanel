import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { RouteTabs, routeTabClassName } from "@/components/route-tabs";

export const Route = createFileRoute("/_app/account")({
	component: AccountLayout,
});

function AccountLayout() {
	return (
		<>
			<div className="space-y-4">
				<PageHeader
					border={false}
					description="Manage your personal account and access."
					title="Account"
				/>
				<RouteTabs label="Account sections">
					<Link
						activeOptions={{ exact: true }}
						className={routeTabClassName}
						to="/account"
					>
						General
					</Link>
					<Link className={routeTabClassName} to="/account/ssh-keys">
						SSH keys
					</Link>
					<Link className={routeTabClassName} to="/account/activity">
						Activity
					</Link>
				</RouteTabs>
			</div>
			<Outlet />
		</>
	);
}
