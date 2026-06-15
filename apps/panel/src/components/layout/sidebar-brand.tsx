import { Cookie } from "lucide-react";
import { SidebarHeader } from "@/components/ui/sidebar";

// The CookiePanel wordmark, shared by the app and admin sidebars. A static
// brand, not a control. The header is h-14 with its border included
// (border-box), so its bottom hairline lands at the same y as the content
// topbar's — one continuous line.
export function SidebarBrand() {
	return (
		<SidebarHeader className="h-14 border-b p-0">
			<div className="flex h-full items-center gap-2 px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
				<Cookie className="size-5 shrink-0 text-primary" strokeWidth={2} />
				<span className="font-bold text-base tracking-tight group-data-[collapsible=icon]:hidden">
					CookiePanel
				</span>
			</div>
		</SidebarHeader>
	);
}
