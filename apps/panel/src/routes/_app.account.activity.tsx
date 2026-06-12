import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

export const Route = createFileRoute("/_app/account/activity")({
	component: AccountActivity,
});

function AccountActivity() {
	return (
		<EmptyState
			description="Sign-ins and changes to your account will show up here."
			icon={Activity}
			title="No activity yet"
		/>
	);
}
