import type { ReactNode } from "react";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

// The shared app/admin chrome: skip-link, sidebar, sticky topbar, and the
// centered content column. Each surface supplies its own sidebar and topbar
// contents; the frame keeps the structure (and the a11y wiring) identical.
export function ShellFrame({
	sidebar,
	headerStart,
	headerEnd,
	children,
}: {
	sidebar: ReactNode;
	/** Topbar content after the sidebar trigger (e.g. the command menu). */
	headerStart?: ReactNode;
	/** Topbar content pinned to the right (notifications, account menu). */
	headerEnd?: ReactNode;
	children: ReactNode;
}) {
	return (
		<SidebarProvider>
			<a
				className="sr-only rounded-md bg-primary px-3 py-2 font-mono text-primary-foreground text-xs uppercase tracking-wider focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
				href="#main-content"
			>
				Skip to content
			</a>
			{sidebar}
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
					<SidebarTrigger className="-ml-1" />
					{headerStart}
					<div className="ml-auto flex items-center gap-2">{headerEnd}</div>
				</header>
				<div
					className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-6 outline-none"
					id="main-content"
					tabIndex={-1}
				>
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
