// The two surfaces that manage eggs differ only in a handful of ways: the
// org catalog (/eggs) where members deploy from a mix of official + own
// eggs, and the admin library (/admin/eggs) where admins curate the
// official, platform-owned ones. This captures those differences in one object
// so the shared eggs UI (catalog, detail, editor, management, create/import)
// works on both. Paths are plain strings — call sites widen past the router's
// typed-route checking at the Link/navigate boundary (as PageHeader's back-link
// does).

export type EggScope = {
	/** Whether this surface creates/manages official (platform-owned) eggs. */
	official: boolean;
	// Navigation targets within the surface.
	listPath: string;
	detailPath: string;
	editPath: string;
	newPath: string;
	/** Per-surface key for the grid/list view-toggle persistence. */
	viewKey: string;
	// List-page copy.
	listDescription: string;
	emptyTitle: string;
	emptyDescription: string;
};

/** The org catalog: a member's mix of official + own eggs, to deploy from. */
export const ORG_EGG_SCOPE: EggScope = {
	official: false,
	listPath: "/eggs",
	detailPath: "/eggs/$eggId",
	editPath: "/eggs/$eggId/edit",
	newPath: "/eggs/new",
	viewKey: "eggs",
	listDescription: "Reusable recipes for deploying servers.",
	emptyTitle: "No eggs yet",
	emptyDescription: "Create or import an egg to deploy servers from it.",
};

/** The admin library: the official eggs every organization deploys from. */
export const ADMIN_EGG_SCOPE: EggScope = {
	official: true,
	listPath: "/admin/eggs",
	detailPath: "/admin/eggs/$eggId",
	editPath: "/admin/eggs/$eggId/edit",
	newPath: "/admin/eggs/new",
	viewKey: "admin-eggs",
	listDescription: "The official eggs every organization can deploy from.",
	emptyTitle: "No official eggs yet",
	emptyDescription:
		"Create or import an official egg for organizations to deploy from.",
};
