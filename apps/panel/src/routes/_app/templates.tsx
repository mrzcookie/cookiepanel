import { createFileRoute } from "@tanstack/react-router";
import { CreateTemplateMenu } from "@/components/templates/create-template-menu";
import { TemplateCatalog } from "@/components/templates/template-catalog";
import {
	templatesListQueryOptions,
	useTemplates,
} from "@/lib/templates-queries";
import { ORG_TEMPLATE_SCOPE } from "@/lib/templates-scope";

export const Route = createFileRoute("/_app/templates")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(templatesListQueryOptions()),
	component: Templates,
});

function Templates() {
	const templates = useTemplates();
	return (
		<TemplateCatalog
			action={<CreateTemplateMenu scope={ORG_TEMPLATE_SCOPE} />}
			scope={ORG_TEMPLATE_SCOPE}
			templates={templates}
		/>
	);
}
