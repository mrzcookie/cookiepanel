import {
	Activity,
	Building2,
	CreditCard,
	Globe,
	HardDrive,
	LayoutDashboard,
	LayoutTemplate,
	Settings,
	Users,
} from "lucide-react";

// Single source of truth for the admin nav (the /admin console's sidebar).
// Separate from `nav.ts` (the org-scoped app nav) because admin is a different
// surface entirely — global/cross-org scope, no org switcher.
export const ADMIN_NAV = [
	{ title: "Overview", to: "/admin", icon: LayoutDashboard },
	{ title: "Organizations", to: "/admin/orgs", icon: Building2 },
	{ title: "Users", to: "/admin/users", icon: Users },
	{ title: "Nodes", to: "/admin/nodes", icon: HardDrive },
	{ title: "Subdomains", to: "/admin/subdomains", icon: Globe },
	{ title: "Templates", to: "/admin/templates", icon: LayoutTemplate },
	{ title: "Billing", to: "/admin/billing", icon: CreditCard },
	{ title: "Activity", to: "/admin/activity", icon: Activity },
	{ title: "Settings", to: "/admin/settings", icon: Settings },
] as const;
