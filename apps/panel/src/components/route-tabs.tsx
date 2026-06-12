import type { ReactNode } from "react";

// Shared styling for a routed tab link (a TanStack `<Link>`). The active tab is
// driven by the router via `data-status="active"` (and `aria-current="page"`).
export const routeTabClassName =
	"border-transparent border-b-2 px-1 pb-3 text-muted-foreground text-sm transition-colors hover:text-foreground data-[status=active]:border-primary data-[status=active]:font-medium data-[status=active]:text-foreground";

export function RouteTabs({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	return (
		<div className="border-b">
			<nav aria-label={label} className="-mb-px flex gap-4">
				{children}
			</nav>
		</div>
	);
}
