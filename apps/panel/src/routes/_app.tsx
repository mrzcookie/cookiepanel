import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PastDueBanner } from "@/components/billing/past-due-banner";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorScreen } from "@/components/layout/error-screen";
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
	// Keep the shell (sidebar + nav) when a page throws, so an error in one view
	// doesn't strand the user on a chrome-less full-screen 500. The root error
	// surface stays the last-resort full-screen fallback.
	errorComponent: ({ reset }) => (
		<AppShell>
			<ErrorScreen
				action={
					<div className="flex items-center justify-center gap-3">
						<Button onClick={reset} size="sm">
							Try again
						</Button>
						<Button asChild size="sm" variant="outline">
							<Link to="/">Back to overview</Link>
						</Button>
					</div>
				}
				className="min-h-[60vh]"
				code="500"
				description="This page hit an unexpected error. Try again, or head back to the overview."
				title="Something went wrong"
			/>
		</AppShell>
	),
});

function AppLayout() {
	return (
		<AppShell>
			<PastDueBanner />
			<Outlet />
		</AppShell>
	);
}
