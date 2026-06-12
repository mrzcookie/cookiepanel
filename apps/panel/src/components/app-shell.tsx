import type { ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { AppSidebar } from "@/components/app-sidebar";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
					<SidebarTrigger className="-ml-1" />
					<div className="ml-auto flex items-center gap-2">
						<AccountMenu />
					</div>
				</header>
				<div className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-6">
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
