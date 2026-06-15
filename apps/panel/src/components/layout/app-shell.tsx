import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
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
			{children}
		</ShellFrame>
	);
}
