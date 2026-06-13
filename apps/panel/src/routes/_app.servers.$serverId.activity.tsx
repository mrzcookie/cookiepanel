import { createFileRoute } from "@tanstack/react-router";
import {
	Archive,
	CalendarClock,
	type LucideIcon,
	Pencil,
	Play,
	Plus,
	RotateCw,
	Server,
	Square,
	Upload,
} from "lucide-react";
import { type ActivityItem, ActivityList } from "@/components/activity-list";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useServer } from "@/lib/servers-store";
import type { ServerRow } from "@/lib/stubs";

export const Route = createFileRoute("/_app/servers/$serverId/activity")({
	component: ServerActivityTab,
});

// A believable, server-scoped audit trail for the UI-first phase. Real activity
// is read from the org's activity log filtered to this server; here it's woven
// from the server's own fields so it reads as this server's history.
function activityFor(server: ServerRow): ActivityItem[] {
	const entry = (
		id: string,
		icon: LucideIcon,
		actor: string,
		description: string,
		time: string
	): ActivityItem => ({ id, icon, actor, description, time });

	return [
		entry("1", Play, "Jane Cooper", "started the server", "12 minutes ago"),
		entry(
			"2",
			Archive,
			"System",
			"completed a scheduled backup (1.8 GB)",
			"2 hours ago"
		),
		entry("3", Pencil, "Marco Diaz", "edited server.properties", "5 hours ago"),
		entry(
			"4",
			CalendarClock,
			"System",
			"ran schedule “Nightly restart”",
			"Yesterday"
		),
		entry(
			"5",
			Plus,
			"Jane Cooper",
			`allocated a port on ${server.nodeName}`,
			"Yesterday"
		),
		entry("6", RotateCw, "Marco Diaz", "restarted the server", "2 days ago"),
		entry(
			"7",
			Upload,
			"Jane Cooper",
			"uploaded files to the data volume",
			"3 days ago"
		),
		entry(
			"8",
			Square,
			"System",
			"stopped the server for maintenance",
			"4 days ago"
		),
		entry(
			"9",
			Server,
			"Jane Cooper",
			`created the server from ${server.templateName}`,
			server.createdAt
		),
	];
}

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
