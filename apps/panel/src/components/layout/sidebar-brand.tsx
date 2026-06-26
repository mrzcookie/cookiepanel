import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarHeader } from "@/components/ui/sidebar";

// The Raptor Panel wordmark, shared by the app and admin sidebars. A static
// brand, not a control. The header is h-14 with its border included
// (border-box), so its bottom hairline lands at the same y as the content
// topbar's — one continuous line.
export function SidebarBrand() {
	return (
		<SidebarHeader className="h-14 border-b p-0">
			<div className="flex h-full items-center gap-2 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
				<BrandMark className="shrink-0" />
				<span className="font-bold text-base tracking-tight group-data-[collapsible=icon]:hidden">
					Raptor Panel
				</span>
			</div>
		</SidebarHeader>
	);
}
