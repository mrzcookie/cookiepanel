import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ComponentProps } from "react";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";
import { ADMIN_NAV } from "@/lib/admin-nav";

export function AdminSidebar(props: ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarBrand />
			<SidebarContent>
				<SidebarNav homePath="/admin" items={ADMIN_NAV} label={"// admin"} />
			</SidebarContent>
			<SidebarFooter className="border-t">
				<SidebarMenu>
					<SidebarMenuItem>
						{/* The way back to the org app — this surface has no org chrome. */}
						<SidebarMenuButton asChild className="h-9" tooltip="Back to app">
							<Link to="/">
								<ArrowLeft />
								<span>Back to app</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
