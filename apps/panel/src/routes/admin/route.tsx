import {
	createFileRoute,
	Link,
	notFound,
	Outlet,
	redirect,
	rootRouteId,
} from "@tanstack/react-router";
import { AdminShell } from "@/components/layout/admin-shell";
import { ErrorScreen } from "@/components/layout/error-screen";
import { Button } from "@/components/ui/button";
import { fetchIsPlatformAdmin, fetchSession } from "@/server/auth/session";

export const Route = createFileRoute("/admin")({
	// The platform-admin surface is gated here. Admin is a GLOBAL capability (an
	// admin-plugin role or an env-bootstrapped id), NOT org membership — the check
	// is server-verified via `fetchIsPlatformAdmin`, the same predicate `requirePlatformAdmin`
	// enforces on every admin server fn, so the env-bootstrapped admin list never
	// reaches the client. Runs on the server during SSR and on the client on
	// navigation. This is the UX gate; each admin server fn re-checks `requirePlatformAdmin`
	// as the hard backstop (defense in depth), so the surface is never open.
	beforeLoad: async ({ location }) => {
		const session = await fetchSession();
		if (!session) {
			// Signed out: their admin status is unknown until they authenticate, so
			// send them to log in (consistent with `_app`) rather than 404.
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		// A known non-admin gets a generic not-found, NOT a redirect or a "forbidden":
		// the /admin console must be indistinguishable from a route that doesn't
		// exist, so its existence can't be probed (the generic-not-found principle
		// in security.md). Target the root boundary so they see the plain app 404 —
		// no admin chrome, no "Back to admin" link that would give the surface away.
		if (!(await fetchIsPlatformAdmin())) {
			throw notFound({ routeId: rootRouteId });
		}
	},
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
