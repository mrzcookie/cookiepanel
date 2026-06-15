import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { NotificationsPanel } from "@/components/layout/notifications-panel";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider>
			<a
				className="sr-only rounded-md bg-primary px-3 py-2 font-mono text-primary-foreground text-xs uppercase tracking-wider focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
				href="#main-content"
			>
				Skip to content
			</a>
			<AppSidebar />
			<SidebarInset>
				<header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
					<SidebarTrigger className="-ml-1" />
					<CommandMenu />
					<div className="ml-auto flex items-center gap-2">
						<NotificationsPanel />
						<AccountMenu />
					</div>
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
