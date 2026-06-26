import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { EggEditor } from "@/components/eggs/egg-editor";
import { EggManagement } from "@/components/eggs/egg-management";
import { ErrorScreen } from "@/components/layout/error-screen";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { eggToState } from "@/lib/domain/eggs-editor";
import { eggEditQueryOptions } from "@/lib/eggs-queries";
import { ORG_EGG_SCOPE } from "@/lib/eggs-scope";

// Trailing underscore on `$eggId_` opts this route OUT of nesting under the
// detail route, so `/eggs/X/edit` renders the editor, not the detail page.
export const Route = createFileRoute("/_app/eggs_/$eggId_/edit")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(eggEditQueryOptions(params.eggId)),
	component: EditEgg,
});

function EditEgg() {
	const { eggId } = Route.useParams();
	// The edit view carries raw image strings and resolves only for an egg
	// this org owns; a missing or official (read-only) one comes back null, and
	// resolves to the same friendly screen so the two are indistinguishable.
	const { data: egg } = useSuspenseQuery(eggEditQueryOptions(eggId));

	if (!egg) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/eggs">Back to eggs</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or it's an official egg that's read-only."
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
					to: "/eggs/$eggId",
				}}
				description="Edit this egg's recipe."
				title="Edit egg"
			/>

			<EggEditor
				initial={eggToState(egg)}
				mode="edit"
				scope={ORG_EGG_SCOPE}
				eggId={egg.id}
			/>

			<div className="mt-8">
				<EggManagement scope={ORG_EGG_SCOPE} egg={egg} />
			</div>
		</>
	);
}
