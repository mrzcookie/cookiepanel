import { createFileRoute } from "@tanstack/react-router";
import { CreateEggMenu } from "@/components/eggs/create-egg-menu";
import { EggCatalog } from "@/components/eggs/egg-catalog";
import { eggsListQueryOptions, useEggs } from "@/lib/eggs-queries";
import { ORG_EGG_SCOPE } from "@/lib/eggs-scope";

export const Route = createFileRoute("/_app/eggs")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(eggsListQueryOptions()),
	component: Eggs,
});

function Eggs() {
	const eggs = useEggs();
	return (
		<EggCatalog
			action={<CreateEggMenu scope={ORG_EGG_SCOPE} />}
			scope={ORG_EGG_SCOPE}
			eggs={eggs}
		/>
	);
}
