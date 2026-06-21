import { createFileRoute } from "@tanstack/react-router";
import { CreateTemplateMenu } from "@/components/templates/create-template-menu";
import { TemplateCatalog } from "@/components/templates/template-catalog";
import {
	adminTemplatesListQueryOptions,
	useAdminTemplates,
} from "@/lib/templates-queries";
import { ADMIN_TEMPLATE_SCOPE } from "@/lib/templates-scope";

export const Route = createFileRoute("/admin/templates/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminTemplatesListQueryOptions()),
	component: AdminTemplates,
});

function AdminTemplates() {
	// The official, platform-owned library — every status, incl. drafts.
	const templates = useAdminTemplates();
	return (
		<TemplateCatalog
			action={<CreateTemplateMenu scope={ADMIN_TEMPLATE_SCOPE} />}
			scope={ADMIN_TEMPLATE_SCOPE}
			templates={templates}
		/>
	);
}
