import { Link, useLocation } from "@tanstack/react-router";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { isNavActive, type NavItem } from "@/lib/nav";

// The primary-nav list shared by the app and admin sidebars. `to` values come
// from a curated nav table (NAV / ADMIN_NAV), so we widen past the router's
// typed-route checking at this one boundary — the same trade-off PageHeader's
// back-link makes.
export function SidebarNav({
	label,
	items,
	homePath,
}: {
	/** The `// section` mono group label. */
	label: string;
	items: readonly NavItem[];
	/** The surface's home route, matched exactly (see isNavActive). */
	homePath: string;
}) {
	const pathname = useLocation({ select: (location) => location.pathname });

	return (
		<SidebarGroup>
			<SidebarGroupLabel className="font-mono text-[0.7rem] uppercase tracking-[0.18em]">
				{label}
			</SidebarGroupLabel>
			<SidebarMenu className="gap-1">
				{items.map((item) => (
					<SidebarMenuItem key={item.to}>
						<SidebarMenuButton
							asChild
							className="h-9"
							isActive={isNavActive(pathname, item.to, homePath)}
							tooltip={item.title}
						>
							<Link to={item.to as never}>
								<item.icon />
								<span>{item.title}</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
