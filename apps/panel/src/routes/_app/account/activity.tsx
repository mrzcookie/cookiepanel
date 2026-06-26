import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Activity,
	Box,
	Building2,
	CreditCard,
	LayoutTemplate,
	Loader2,
	LogIn,
	type LucideIcon,
	Network,
	Server,
	UserRound,
	Users,
} from "lucide-react";
import {
	type ActivityItem,
	ActivityList,
} from "@/components/shared/activity-list";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { myActivityQueryOptions } from "@/lib/activity-queries";
import type { ActivityCategory, ActivityEntry } from "@/lib/domain/activity";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/_app/account/activity")({
	loader: ({ context }) =>
		context.queryClient.ensureInfiniteQueryData(myActivityQueryOptions()),
	component: AccountActivity,
});

const ICON_BY_CATEGORY: Record<ActivityCategory, LucideIcon> = {
	auth: LogIn,
	account: UserRound,
	organization: Building2,
	member: Users,
	node: Server,
	server: Box,
	network: Network,
	egg: LayoutTemplate,
	billing: CreditCard,
};

/**
 * A human, second-person line for one of the user's own actions. The recorded
 * action keys are stable; anything unmapped falls back to a humanized key so a
 * new action still reads sensibly rather than disappearing.
 */
function describe(entry: ActivityEntry): string {
	switch (entry.action) {
		case "login":
			return entry.ip ? `Logged in from ${entry.ip}` : "Logged in";
		case "account.avatar_updated":
			return "Updated your avatar";
		case "account.avatar_removed":
			return "Removed your avatar";
		case "organization.created":
			return entry.target
				? `Created the organization ${entry.target}`
				: "Created an organization";
		case "member.joined":
			return "Joined an organization";
		case "member.invited":
			return entry.target ? `Invited ${entry.target}` : "Invited a member";
		case "node.created":
			return entry.target
				? `Connected the node ${entry.target}`
				: "Connected a node";
		case "node.deleted":
			return entry.target
				? `Removed the node ${entry.target}`
				: "Removed a node";
		case "egg.created":
			return entry.target ? `Created the egg ${entry.target}` : "Created a egg";
		case "egg.updated":
			return entry.target ? `Edited the egg ${entry.target}` : "Edited a egg";
		case "egg.published":
			return entry.target
				? `Published the egg ${entry.target}`
				: "Published a egg";
		case "egg.unpublished":
			return entry.target
				? `Moved the egg ${entry.target} back to draft`
				: "Unpublished a egg";
		case "egg.archived":
			return entry.target
				? `Archived the egg ${entry.target}`
				: "Archived a egg";
		case "egg.forked":
			return entry.target
				? `Customized the egg ${entry.target}`
				: "Customized a egg";
		case "egg.imported":
			return entry.target
				? `Imported the egg ${entry.target}`
				: "Imported a egg";
		case "egg.deleted":
			return entry.target ? `Deleted the egg ${entry.target}` : "Deleted a egg";
		default: {
			const phrase = entry.action.replace(/[._]/g, " ");
			const base = phrase.charAt(0).toUpperCase() + phrase.slice(1);
			return entry.target ? `${base}: ${entry.target}` : base;
		}
	}
}

function toActivityItem(entry: ActivityEntry): ActivityItem {
	return {
		id: entry.id,
		// Fallback covers a runtime category outside the known set (the server
		// projects it as a string).
		icon: ICON_BY_CATEGORY[entry.category] ?? Activity,
		description: describe(entry),
		time: formatRelativeTime(entry.createdAt),
	};
}

function AccountActivity() {
	const query = useSuspenseInfiniteQuery(myActivityQueryOptions());
	const items = query.data.pages.flat().map(toActivityItem);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					Recent logins and changes to your account.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<ActivityList items={items} />
				{query.hasNextPage ? (
					<Button
						disabled={query.isFetchingNextPage}
						onClick={() => query.fetchNextPage()}
						size="sm"
						variant="outline"
					>
						{query.isFetchingNextPage ? (
							<Loader2 className="animate-spin" />
						) : null}
						Load more
					</Button>
				) : null}
			</CardContent>
		</Card>
	);
}
