import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense } from "react";
import appCss from "@/styles/global.css?url";

const Devtools = import.meta.env.DEV
	? lazy(() =>
			Promise.all([
				import("@tanstack/react-devtools"),
				import("@tanstack/react-router-devtools"),
			]).then(([{ TanStackDevtools }, router]) => ({
				default: () => (
					<TanStackDevtools
						config={{ position: "bottom-right" }}
						plugins={[
							{
								name: "TanStack Router",
								render: <router.TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				),
			}))
		)
	: null;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "CookiePanel" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-svh flex-col">
				{children}
				{Devtools && (
					<Suspense fallback={null}>
						<Devtools />
					</Suspense>
				)}
				<Scripts />
			</body>
		</html>
	);
}
