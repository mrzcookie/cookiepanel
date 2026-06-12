import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, LogIn, SunMoon, UserRound } from "lucide-react";
import { type ActivityItem, ActivityList } from "@/components/activity-list";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/_app/account/activity")({
	component: AccountActivity,
});

const ITEMS: ActivityItem[] = [
	{
		id: "1",
		icon: LogIn,
		description: "Signed in from San Francisco, CA",
		time: "2 hours ago",
	},
	{
		id: "2",
		icon: KeyRound,
		description: "Added SSH key “MacBook Pro”",
		time: "Yesterday",
	},
	{
		id: "3",
		icon: SunMoon,
		description: "Switched the theme to Dark",
		time: "May 28, 2026",
	},
	{
		id: "4",
		icon: UserRound,
		description: "Updated your profile",
		time: "May 20, 2026",
	},
	{
		id: "5",
		icon: LogIn,
		description: "Signed in from San Francisco, CA",
		time: "May 12, 2026",
	},
];

function AccountActivity() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					Recent sign-ins and changes to your account.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ActivityList items={ITEMS} />
			</CardContent>
		</Card>
	);
}
