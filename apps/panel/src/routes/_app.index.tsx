import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_app/")({
	component: Overview,
});

function Overview() {
	return (
		<>
			<PageHeader
				description="Your fleet at a glance."
				eyebrow="fleet"
				title="Overview"
			/>
			<EmptyState
				icon={LayoutDashboard}
				title="Nothing to show yet"
				description="Connect a node to see live stats and recent activity."
			/>
		</>
	);
}
