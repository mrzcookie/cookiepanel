import { createFileRoute } from "@tanstack/react-router";
import { activityFor } from "@/components/servers/server-activity";
import { ActivityList } from "@/components/shared/activity-list";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useServer } from "@/lib/server-queries";

export const Route = createFileRoute("/_app/servers/$serverId/activity")({
	component: ServerActivityTab,
});

function ServerActivityTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);

	if (!server) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					Recent actions on {server.name}, newest first.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ActivityList items={activityFor(server)} />
			</CardContent>
		</Card>
	);
}
