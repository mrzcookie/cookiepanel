import { createFileRoute } from "@tanstack/react-router";
import { Building2, HardDrive, Server, UserPlus } from "lucide-react";
import { type ActivityItem, ActivityList } from "@/components/activity-list";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/_app/settings/activity")({
	component: SettingsActivity,
});

const ITEMS: ActivityItem[] = [
	{
		id: "1",
		icon: UserPlus,
		actor: "Jane Cooper",
		description: "invited marco@example.com as Admin",
		time: "2 hours ago",
	},
	{
		id: "2",
		icon: Server,
		actor: "Marco Diaz",
		description: "created server “mc-survival”",
		time: "Yesterday",
	},
	{
		id: "3",
		icon: HardDrive,
		actor: "Jane Cooper",
		description: "connected node “web-01”",
		time: "May 30, 2026",
	},
	{
		id: "4",
		icon: Building2,
		actor: "Jane Cooper",
		description: "created the organization",
		time: "May 1, 2026",
	},
];

function SettingsActivity() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					Recent actions across this organization.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ActivityList items={ITEMS} />
			</CardContent>
		</Card>
	);
}
