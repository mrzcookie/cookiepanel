import type { ComponentProps } from "react";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { SidebarBrand } from "@/components/layout/sidebar-brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarRail,
} from "@/components/ui/sidebar";
import { NAV } from "@/lib/nav";
import { useNodeCounts } from "@/lib/stores/nodes-store";

// The sidebar footer's instrument readout: how many of the fleet's boxes are
// reporting, in mono with an alpha-only pulse on the live count.
function NodeReadout() {
	const { online, total } = useNodeCounts();

	return (
		<div className="flex items-center gap-2 px-2 py-1 font-mono text-xs">
			<span className="animate-[live-pulse_1.4s_ease-in-out_infinite] text-ok tabular-nums motion-reduce:animate-none">
				[ {online} ONLINE ]
			</span>
			<span className="text-muted-foreground tabular-nums">
				/ {total} NODES
			</span>
		</div>
	);
}

export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarBrand />
			<SidebarContent>
				<div className="px-2 pt-2 group-data-[collapsible=icon]:px-1.5">
					<OrgSwitcher />
				</div>
				<SidebarNav homePath="/" items={NAV} label={"// manage"} />
			</SidebarContent>
			<SidebarFooter className="border-t group-data-[collapsible=icon]:hidden">
				<NodeReadout />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
