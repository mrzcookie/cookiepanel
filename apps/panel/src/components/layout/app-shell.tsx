import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
import { AccountThemeSync } from "@/components/layout/account-theme-sync";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandMenu } from "@/components/layout/command-menu";
import { NotificationsPanel } from "@/components/layout/notifications-panel";
import { ShellFrame } from "@/components/layout/shell-frame";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<ShellFrame
			headerEnd={
				<>
					<NotificationsPanel />
					<AccountMenu />
				</>
			}
			headerStart={<CommandMenu />}
			sidebar={<AppSidebar />}
		>
			<AccountThemeSync />
			{children}
		</ShellFrame>
	);
}
