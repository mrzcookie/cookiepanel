import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/admin-shell";
import { ErrorScreen } from "@/components/layout/error-screen";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
	// Admin gating lands with auth: a `beforeLoad` guard will read the session,
	// re-verify the user holds the admin flag (a separate, global capability —
	// NOT org membership), and bounce everyone else to `/`. The UI-first phase
	// has no auth, so the surface is open for now.
	component: AdminLayout,
	// Sibling of `_app` on purpose: admin is its own surface with its own shell,
	// so it must not inherit the org-scoped app chrome (sidebar, org switcher).
	// Unmatched paths render inside the already-mounted shell, so this one is NOT
	// wrapped in AdminShell (the errorComponent below is — an error can tear the
	// layout down). Mirrors the _app split.
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/admin">Back to admin</Link>
				</Button>
			}
			className="min-h-[60vh]"
			code="404"
			description="That admin page doesn't exist. Pick a section from the sidebar, or head back."
			title="Page not found"
			tone="muted"
		/>
	),
	// Keep the shell when a page throws, so an error in one section doesn't
	// strand the operator on a chrome-less full-screen 500.
	errorComponent: ({ reset }) => (
		<AdminShell>
			<ErrorScreen
				action={
					<div className="flex items-center justify-center gap-3">
						<Button onClick={reset} size="sm">
							Try again
						</Button>
						<Button asChild size="sm" variant="outline">
							<Link to="/admin">Back to admin</Link>
						</Button>
					</div>
				}
				className="min-h-[60vh]"
				code="500"
				description="This page hit an unexpected error. Try again, or head back to the admin overview."
				title="Something went wrong"
			/>
		</AdminShell>
	),
});

function AdminLayout() {
	return (
		<AdminShell>
			<Outlet />
		</AdminShell>
	);
}
