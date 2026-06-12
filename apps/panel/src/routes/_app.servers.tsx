import { createFileRoute } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_app/servers")({
	component: Servers,
});

function Servers() {
	return (
		<>
			<PageHeader
				title="Servers"
				description="Game and app instances you're running."
			/>
			<EmptyState
				icon={Server}
				title="No servers yet"
				description="Servers you deploy from a template will appear here."
			/>
		</>
	);
}
