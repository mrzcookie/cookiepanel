import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ErrorScreen } from "@/components/error-screen";
import { PageHeader } from "@/components/page-header";
import { RouteTabs, routeTabClassName } from "@/components/route-tabs";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/account")({
	component: AccountLayout,
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/account">Back to account</Link>
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

function AccountLayout() {
	return (
		<>
			<div className="space-y-4">
				<PageHeader
					border={false}
					description="Manage your personal account and access."
					eyebrow="account"
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
