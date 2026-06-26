import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutTemplate, Pencil } from "lucide-react";
import { CustomizeButton } from "@/components/eggs/customize-button";
import { EggDetailBody } from "@/components/eggs/egg-detail";
import { UseEggDialog } from "@/components/eggs/use-egg-dialog";
import { ErrorScreen } from "@/components/layout/error-screen";
import { EntityIconChip } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type Egg, isDeployable, isEditable } from "@/lib/domain/eggs";
import { eggsListQueryOptions, useEgg } from "@/lib/eggs-queries";

export const Route = createFileRoute("/_app/eggs_/$eggId")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(eggsListQueryOptions()),
	component: EggDetail,
});

function EggDetail() {
	const { eggId } = Route.useParams();
	const egg = useEgg(eggId);

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
				description="It may have been removed, or you followed an old link."
				title="Egg not found"
				tone="muted"
			/>
		);
	}

	return <EggView egg={egg} />;
}

function EggView({ egg }: { egg: Egg }) {
	const editable = isEditable(egg);
	const deployable = isDeployable(egg);

	return (
		<>
			<PageHeader
				actions={
					<>
						{editable ? (
							<Button asChild variant="outline">
								<Link params={{ eggId: egg.id }} to="/eggs/$eggId/edit">
									<Pencil className="size-4" /> Edit
								</Link>
							</Button>
						) : (
							<CustomizeButton eggId={egg.id} />
						)}
						{deployable ? <UseEggDialog egg={egg} /> : null}
					</>
				}
				back={{ label: "Eggs", to: "/eggs" }}
				description={`${egg.category} · v${egg.version}`}
				title={
					<span className="flex items-center gap-2.5">
						<EntityIconChip icon={LayoutTemplate} imageUrl={egg.iconUrl} />
						{egg.name}
						{egg.official ? <Badge variant="secondary">Official</Badge> : null}
					</span>
				}
			/>

			<EggDetailBody canEdit={editable} egg={egg} />
		</>
	);
}
