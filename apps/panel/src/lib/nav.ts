import {
	HardDrive,
	LayoutDashboard,
	LayoutTemplate,
	Network,
	Server,
	Settings,
} from "lucide-react";

// Single source of truth for the primary nav (sidebar today, mobile menu later).
export const NAV = [
	{ title: "Overview", to: "/", icon: LayoutDashboard },
	{ title: "Nodes", to: "/nodes", icon: HardDrive },
	{ title: "Servers", to: "/servers", icon: Server },
	{ title: "Networks", to: "/networks", icon: Network },
	{ title: "Templates", to: "/templates", icon: LayoutTemplate },
	{ title: "Settings", to: "/settings", icon: Settings },
] as const;
