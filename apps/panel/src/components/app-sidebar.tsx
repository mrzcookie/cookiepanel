import { Link, useLocation } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import type { ComponentProps } from "react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";
import { NAV } from "@/lib/nav";

function isActive(pathname: string, to: string) {
	return to === "/"
		? pathname === "/"
		: pathname === to || pathname.startsWith(`${to}/`);
}

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
	const pathname = useLocation({ select: (location) => location.pathname });

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader className="h-14 border-b p-0">
				{/* Static brand: a logo, not a control. The header is h-14 with the
				    border included (border-box), so its bottom hairline lands at the
				    same y as the content topbar's — one continuous line. */}
				<div className="flex h-full items-center gap-2 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
					<Cookie className="size-5 shrink-0 text-primary" strokeWidth={2} />
					<span className="font-bold text-base tracking-tight group-data-[collapsible=icon]:hidden">
						CookiePanel
					</span>
				</div>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu className="gap-1">
						{NAV.map((item) => (
							<SidebarMenuItem key={item.to}>
								<SidebarMenuButton
									asChild
									className="h-9"
									isActive={isActive(pathname, item.to)}
									tooltip={item.title}
								>
									<Link to={item.to}>
										<item.icon />
										<span>{item.title}</span>
									</Link>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>

			<SidebarRail />
		</Sidebar>
	);
}
