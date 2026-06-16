import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
	// A fresh QueryClient per request (getRouter runs per request on the
	// server), so cache state never leaks across requests.
	const queryClient = new QueryClient({
		defaultOptions: {
			// Data preloaded in loaders stays fresh past hydration, so
			// useSuspenseQuery doesn't refetch on mount. Live readouts opt into
			// polling per-query via refetchInterval.
			queries: { staleTime: 60_000 },
		},
	});

	const router = createRouter({
		routeTree,
		context: { queryClient },

		// Configuration Options
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		scrollRestoration: true,
	});

	// Dehydrate/hydrate the query cache across the SSR boundary and wrap the
	// app in this request's QueryClientProvider.
	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
};
