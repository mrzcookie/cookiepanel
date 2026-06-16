import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutTemplate, Pencil } from "lucide-react";
import { ErrorScreen } from "@/components/layout/error-screen";
import { EntityIconChip } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { CustomizeButton } from "@/components/templates/customize-button";
import { TemplateDetailBody } from "@/components/templates/template-detail";
import { UseTemplateDialog } from "@/components/templates/use-template-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	isDeployable,
	isEditable,
	type Template,
} from "@/lib/domain/templates";
import { useTemplate } from "@/lib/stores/templates-store";

export const Route = createFileRoute("/_app/templates_/$templateId")({
	component: TemplateDetail,
});

function TemplateDetail() {
	const { templateId } = Route.useParams();
	const template = useTemplate(templateId);

	if (!template) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/templates">Back to templates</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Template not found"
				tone="muted"
			/>
		);
	}

	return <TemplateView template={template} />;
}

function TemplateView({ template }: { template: Template }) {
	const editable = isEditable(template);
	const deployable = isDeployable(template);

	return (
		<>
			<PageHeader
				actions={
					<>
						{editable ? (
							<Button asChild variant="outline">
								<Link
									params={{ templateId: template.id }}
									to="/templates/$templateId/edit"
								>
									<Pencil className="size-4" /> Edit
								</Link>
							</Button>
						) : (
							<CustomizeButton templateId={template.id} />
						)}
						{deployable ? <UseTemplateDialog template={template} /> : null}
					</>
				}
				back={{ label: "Templates", to: "/templates" }}
				description={`${template.category} · v${template.version}`}
				title={
					<span className="flex items-center gap-2.5">
						<EntityIconChip icon={LayoutTemplate} imageUrl={template.iconUrl} />
						{template.name}
						{template.official ? (
							<Badge variant="secondary">Official</Badge>
						) : null}
					</span>
				}
			/>

			<TemplateDetailBody canEdit={editable} template={template} />
		</>
	);
}
