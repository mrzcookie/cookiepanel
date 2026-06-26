import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Scripts,
} from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { lazy, type ReactNode, Suspense } from "react";
import { ErrorScreen } from "@/components/layout/error-screen";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "@/styles/global.css?url";

const Devtools = import.meta.env.DEV
	? lazy(() =>
			Promise.all([
				import("@tanstack/react-devtools"),
				import("@tanstack/react-router-devtools"),
				import("@tanstack/react-query-devtools"),
				import("@tanstack/react-form-devtools"),
			]).then(([{ TanStackDevtools }, router, query, form]) => ({
				default: () => (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "TanStack Router",
								render: <router.TanStackRouterDevtoolsPanel />,
							},
							{
								name: "TanStack Query",
								render: <query.ReactQueryDevtoolsPanel />,
							},
							// The Form package ships its own plugin helper (sets the name
							// and forwards the devtools theme into the panel) — use it
							// rather than mounting the bare panel.
							form.formDevtoolsPlugin(),
						]}
					/>
				),
			}))
		)
	: null;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
	{
		head: () => ({
			meta: [
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				{ title: "RaptorPanel" },
			],
			links: [{ rel: "stylesheet", href: appCss }],
		}),
		notFoundComponent: () => (
			<ErrorScreen
				code="404"
				description="That page doesn't exist, or it moved. Check the address, or head back to your fleet."
				title="Page not found"
				tone="muted"
			/>
		),
		errorComponent: () => (
			<ErrorScreen
				code="500"
				description="Something broke on our end. The team has been notified; try again in a moment."
				title="Something went wrong"
			/>
		),
		shellComponent: RootDocument,
	}
);

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-svh flex-col">
				<ThemeProvider
					attribute="class"
					defaultTheme="dark"
					disableTransitionOnChange
					enableSystem
				>
					<TooltipProvider>{children}</TooltipProvider>
					{Devtools && (
						<Suspense fallback={null}>
							<Devtools />
						</Suspense>
					)}
					<Toaster />
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
