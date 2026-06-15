import { createFileRoute } from "@tanstack/react-router";
import { CreateTemplateMenu } from "@/components/templates/create-template-menu";
import { TemplateCatalog } from "@/components/templates/template-catalog";
import { useTemplates } from "@/lib/stores/templates-store";
import { ADMIN_TEMPLATE_SCOPE } from "@/lib/templates-scope";

export const Route = createFileRoute("/admin/templates/")({
	component: AdminTemplates,
});

function AdminTemplates() {
	// Admins curate only the official, platform-owned templates.
	const templates = useTemplates().filter((template) => template.official);
	return (
		<TemplateCatalog
			action={<CreateTemplateMenu scope={ADMIN_TEMPLATE_SCOPE} />}
			scope={ADMIN_TEMPLATE_SCOPE}
			templates={templates}
		/>
	);
}
