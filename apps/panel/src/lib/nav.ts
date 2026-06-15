import {
	HardDrive,
	LayoutDashboard,
	LayoutTemplate,
	type LucideIcon,
	Network,
	Server,
	Settings,
} from "lucide-react";

/** One primary-nav entry, shared by the app and admin sidebars. */
export type NavItem = { title: string; to: string; icon: LucideIcon };

// Whether a nav item is the active route. The surface's home (`homePath` — `/`
// for the app, `/admin` for admin) matches only exactly; every other base also
// matches its nested paths (e.g. /nodes → /nodes/$id), so it can't light up the
// home item too.
export function isNavActive(pathname: string, to: string, homePath: string) {
	return to === homePath
		? pathname === to
		: pathname === to || pathname.startsWith(`${to}/`);
}

// Single source of truth for the primary nav (sidebar today, mobile menu later).
export const NAV = [
	{ title: "Overview", to: "/", icon: LayoutDashboard },
	{ title: "Nodes", to: "/nodes", icon: HardDrive },
	{ title: "Servers", to: "/servers", icon: Server },
	{ title: "Networks", to: "/networks", icon: Network },
	{ title: "Templates", to: "/templates", icon: LayoutTemplate },
	{ title: "Settings", to: "/settings", icon: Settings },
] as const;
