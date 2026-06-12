import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/settings/members")({
	component: SettingsMembers,
});

function SettingsMembers() {
	return (
		<EmptyState
			action={<Button disabled>Invite member</Button>}
			description="Invite people to help manage this organization's fleet."
			icon={Users}
			title="Just you so far"
		/>
	);
}
