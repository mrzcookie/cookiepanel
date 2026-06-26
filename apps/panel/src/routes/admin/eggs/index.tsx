import { createFileRoute } from "@tanstack/react-router";
import { CreateEggMenu } from "@/components/eggs/create-egg-menu";
import { EggCatalog } from "@/components/eggs/egg-catalog";
import { adminEggsListQueryOptions, useAdminEggs } from "@/lib/eggs-queries";
import { ADMIN_EGG_SCOPE } from "@/lib/eggs-scope";

export const Route = createFileRoute("/admin/eggs/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminEggsListQueryOptions()),
	component: AdminEggs,
});

function AdminEggs() {
	// The official, platform-owned library — every status, incl. drafts.
	const eggs = useAdminEggs();
	return (
		<EggCatalog
			action={<CreateEggMenu scope={ADMIN_EGG_SCOPE} />}
			scope={ADMIN_EGG_SCOPE}
			eggs={eggs}
		/>
	);
}
