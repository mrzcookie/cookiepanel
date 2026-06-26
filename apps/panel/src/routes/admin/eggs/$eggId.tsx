import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutTemplate, Pencil } from "lucide-react";
import { EggDetailBody } from "@/components/eggs/egg-detail";
import { ErrorScreen } from "@/components/layout/error-screen";
import { EntityIconChip } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import type { Egg } from "@/lib/domain/eggs";
import { adminEggsListQueryOptions, useAdminEgg } from "@/lib/eggs-queries";

export const Route = createFileRoute("/admin/eggs/$eggId")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminEggsListQueryOptions()),
	component: AdminEggDetail,
});

function AdminEggDetail() {
	const { eggId } = Route.useParams();
	const egg = useAdminEgg(eggId);

	// The admin library is official-only; a missing (or org-owned) id resolves to
	// the same not-found so the two are indistinguishable.
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
				title="Egg not found"
				tone="muted"
			/>
		);
	}

	return <AdminEggView egg={egg} />;
}

function AdminEggView({ egg }: { egg: Egg }) {
	return (
		<>
			<PageHeader
				actions={
					<Button asChild variant="outline">
						<Link params={{ eggId: egg.id }} to="/admin/eggs/$eggId/edit">
							<Pencil className="size-4" /> Edit
						</Link>
					</Button>
				}
				back={{ label: "Eggs", to: "/admin/eggs" }}
				description={`${egg.category} · v${egg.version}`}
				title={
					<span className="flex items-center gap-2.5">
						<EntityIconChip icon={LayoutTemplate} imageUrl={egg.iconUrl} />
						{egg.name}
					</span>
				}
			/>

			<EggDetailBody canEdit egg={egg} />
		</>
	);
}
