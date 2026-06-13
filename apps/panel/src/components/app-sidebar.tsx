import { Link, useLocation } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import type { ComponentProps } from "react";
import { OrgSwitcher } from "@/components/org-switcher";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";
import { NAV } from "@/lib/nav";
import { useNodes } from "@/lib/nodes-store";

function isActive(pathname: string, to: string) {
	return to === "/"
		? pathname === "/"
		: pathname === to || pathname.startsWith(`${to}/`);
}

// The sidebar footer's instrument readout: how many of the fleet's boxes are
// reporting, in mono with an alpha-only pulse on the live count.
function NodeReadout() {
	const nodes = useNodes();
	const online = nodes.filter((node) => node.status === "online").length;

	return (
		<div className="flex items-center gap-2 px-2 py-1 font-mono text-xs">
			<span className="animate-[live-pulse_1.4s_ease-in-out_infinite] text-ok tabular-nums motion-reduce:animate-none">
				[ {online} ONLINE ]
			</span>
			<span className="text-muted-foreground tabular-nums">
				/ {nodes.length} NODES
			</span>
		</div>
	);
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
				<div className="px-2 pt-2 group-data-[collapsible=icon]:px-1.5">
					<OrgSwitcher />
				</div>
				<SidebarGroup>
					<SidebarGroupLabel className="font-mono text-[0.7rem] uppercase tracking-[0.18em]">
						{"// manage"}
					</SidebarGroupLabel>
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

			<SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
				<NodeReadout />
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
