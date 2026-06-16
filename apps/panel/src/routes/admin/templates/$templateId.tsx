import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutTemplate, Pencil } from "lucide-react";
import { ErrorScreen } from "@/components/layout/error-screen";
import { EntityIconChip } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { TemplateDetailBody } from "@/components/templates/template-detail";
import { Button } from "@/components/ui/button";
import type { Template } from "@/lib/domain/templates";
import { useTemplate } from "@/lib/stores/templates-store";

export const Route = createFileRoute("/admin/templates/$templateId")({
	component: AdminTemplateDetail,
});

function AdminTemplateDetail() {
	const { templateId } = Route.useParams();
	const template = useTemplate(templateId);

	// Admin manages official templates only; an org-owned id (or a missing one)
	// resolves to the same not-found so the two are indistinguishable.
	if (!template?.official) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/admin/templates">Back to templates</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or it isn't an official template."
				title="Template not found"
				tone="muted"
			/>
		);
	}

	return <AdminTemplateView template={template} />;
}

function AdminTemplateView({ template }: { template: Template }) {
	return (
		<>
			<PageHeader
				actions={
					<Button asChild variant="outline">
						<Link
							params={{ templateId: template.id }}
							to="/admin/templates/$templateId/edit"
						>
							<Pencil className="size-4" /> Edit
						</Link>
					</Button>
				}
				back={{ label: "Templates", to: "/admin/templates" }}
				description={`${template.category} · v${template.version}`}
				title={
					<span className="flex items-center gap-2.5">
						<EntityIconChip icon={LayoutTemplate} imageUrl={template.iconUrl} />
						{template.name}
					</span>
				}
			/>

			<TemplateDetailBody canEdit template={template} />
		</>
	);
}
