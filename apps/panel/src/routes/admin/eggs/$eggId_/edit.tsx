import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EggEditor } from "@/components/eggs/egg-editor";
import { EggManagement } from "@/components/eggs/egg-management";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { eggToState } from "@/lib/domain/eggs-editor";
import { adminEggEditQueryOptions } from "@/lib/eggs-queries";
import { ADMIN_EGG_SCOPE } from "@/lib/eggs-scope";

// Trailing underscore on `$eggId_` opts this route OUT of nesting under the
// detail route, so `/admin/eggs/X/edit` renders the editor, not the detail.
export const Route = createFileRoute("/admin/eggs/$eggId_/edit")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(adminEggEditQueryOptions(params.eggId)),
	component: AdminEditEgg,
});

function AdminEditEgg() {
	const { eggId } = Route.useParams();
	// The edit view resolves only for an official egg (raw images included);
	// a missing or org-owned id comes back null → the same friendly screen.
	const { data: egg } = useSuspenseQuery(adminEggEditQueryOptions(eggId));

	if (!egg) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/admin/eggs">Back to eggs</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or it isn't an official egg."
				title="You can't edit that egg"
				tone="muted"
			/>
		);
	}

	return (
		<>
			<PageHeader
				back={{
					label: egg.name,
					params: { eggId: egg.id },
					to: "/admin/eggs/$eggId",
				}}
				description="Edit this official egg's recipe."
				title="Edit egg"
			/>

			<EggEditor
				initial={eggToState(egg)}
				mode="edit"
				scope={ADMIN_EGG_SCOPE}
				eggId={egg.id}
			/>

			<div className="mt-8">
				<EggManagement scope={ADMIN_EGG_SCOPE} egg={egg} />
			</div>
		</>
	);
}
