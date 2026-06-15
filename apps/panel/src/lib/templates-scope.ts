// The two surfaces that manage templates differ only in a handful of ways: the
// org catalog (/templates) where members deploy from a mix of official + own
// templates, and the admin library (/admin/templates) where admins curate the
// official, platform-owned ones. This captures those differences in one object
// so the shared templates UI (catalog, detail, editor, management, create/import)
// works on both. Paths are plain strings — call sites widen past the router's
// typed-route checking at the Link/navigate boundary (as PageHeader's back-link
// does).

export type TemplateScope = {
	/** Whether this surface creates/manages official (platform-owned) templates. */
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

/** The org catalog: a member's mix of official + own templates, to deploy from. */
export const ORG_TEMPLATE_SCOPE: TemplateScope = {
	official: false,
	listPath: "/templates",
	detailPath: "/templates/$templateId",
	editPath: "/templates/$templateId/edit",
	newPath: "/templates/new",
	viewKey: "templates",
	listDescription: "Reusable recipes for deploying servers.",
	emptyTitle: "No templates yet",
	emptyDescription: "Create or import a template to deploy servers from it.",
};

/** The admin library: the official templates every organization deploys from. */
export const ADMIN_TEMPLATE_SCOPE: TemplateScope = {
	official: true,
	listPath: "/admin/templates",
	detailPath: "/admin/templates/$templateId",
	editPath: "/admin/templates/$templateId/edit",
	newPath: "/admin/templates/new",
	viewKey: "admin-templates",
	listDescription: "The official templates every organization can deploy from.",
	emptyTitle: "No official templates yet",
	emptyDescription:
		"Create or import an official template for organizations to deploy from.",
};
