import { createFileRoute } from "@tanstack/react-router";
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
				{/* Per-server activity isn't wired to the org activity log yet; the
				    list renders its own "No activity yet" empty state. */}
				<ActivityList items={[]} />
			</CardContent>
		</Card>
	);
}
