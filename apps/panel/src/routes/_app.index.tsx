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
			<PageHeader title="Overview" description="Your fleet at a glance." />
			<EmptyState
				icon={LayoutDashboard}
				title="Nothing to show yet"
				description="Connect a node to see live stats and recent activity."
			/>
		</>
	);
}
