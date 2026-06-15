import type { ReactNode } from "react";
import { AccountMenu } from "@/components/layout/account-menu";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { ShellFrame } from "@/components/layout/shell-frame";

// The admin chrome: the same frame as the org app, but leaner — no org switcher,
// command menu, or notifications, because this is a global, cross-org surface.
export function AdminShell({ children }: { children: ReactNode }) {
	return (
		<ShellFrame headerEnd={<AccountMenu />} sidebar={<AdminSidebar />}>
			{children}
		</ShellFrame>
	);
}
