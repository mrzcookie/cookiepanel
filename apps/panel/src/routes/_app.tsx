import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ErrorScreen } from "@/components/error-screen";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
	component: AppLayout,
	// Fallback for any unmatched path inside the shell (e.g. a stray segment off a
	// leaf detail route, which can't render its own notFoundComponent). Tabbed
	// layouts set their own tailored one; this catches everything else in-shell.
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/">Back to overview</Link>
				</Button>
			}
			className="min-h-[60vh]"
			code="404"
			description="That page doesn't exist. Check the address, or head back."
			title="Page not found"
			tone="muted"
		/>
	),
});

function AppLayout() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}
