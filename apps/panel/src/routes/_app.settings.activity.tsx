import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_app/settings/activity")({
	component: SettingsActivity,
});

function SettingsActivity() {
	return (
		<EmptyState
			description="Actions taken across this organization will show up here."
			icon={Activity}
			title="No activity yet"
		/>
	);
}
