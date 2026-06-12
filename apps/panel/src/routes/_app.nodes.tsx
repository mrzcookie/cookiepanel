import { createFileRoute } from "@tanstack/react-router";
import { HardDrive } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_app/nodes")({
	component: Nodes,
});

function Nodes() {
	return (
		<>
			<PageHeader
				title="Nodes"
				description="The Linux machines you've connected."
			/>
			<EmptyState
				icon={HardDrive}
				title="No nodes yet"
				description="Connect a machine you own to start running servers on it."
			/>
		</>
	);
}
