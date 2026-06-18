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
import { orgActivityQueryOptions } from "@/lib/activity-queries";
import type { ActivityCategory, ActivityEntry } from "@/lib/domain/activity";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/_app/settings/activity")({
	loader: ({ context }) =>
		context.queryClient.ensureInfiniteQueryData(orgActivityQueryOptions()),
	component: SettingsActivity,
});

const ICON_BY_CATEGORY: Record<ActivityCategory, LucideIcon> = {
	auth: LogIn,
	account: UserRound,
	organization: Building2,
	member: Users,
	node: Server,
	server: Box,
	network: Network,
	template: LayoutTemplate,
	billing: CreditCard,
};

/**
 * A third-person verb phrase for one org action — the actor name is rendered
 * separately (bold) ahead of it, so phrases start lowercase ("invited …"); when
 * an entry has no actor, the caller capitalizes it. Unmapped actions fall back to
 * a humanized key so a new action still reads sensibly rather than vanishing.
 */
function describe(entry: ActivityEntry): string {
	switch (entry.action) {
		case "login":
			return entry.ip ? `logged in from ${entry.ip}` : "logged in";
		case "organization.created":
			return entry.target
				? `created the organization ${entry.target}`
				: "created the organization";
		case "organization.updated":
			return "updated the organization";
		case "organization.logo_updated":
			return "updated the organization logo";
		case "organization.logo_removed":
			return "removed the organization logo";
		case "member.joined":
			return "joined the organization";
		case "member.invited":
			return entry.target ? `invited ${entry.target}` : "invited a member";
		case "node.created":
			return entry.target
				? `connected the node ${entry.target}`
				: "connected a node";
		case "node.deleted":
			return entry.target
				? `removed the node ${entry.target}`
				: "removed a node";
		default: {
			const phrase = entry.action.replace(/[._]/g, " ");
			return entry.target ? `${phrase}: ${entry.target}` : phrase;
		}
	}
}

function toActivityItem(entry: ActivityEntry): ActivityItem {
	const phrase = describe(entry);
	return {
		id: entry.id,
		// Fallback covers a runtime category outside the known set (the server
		// projects it as a string).
		icon: ICON_BY_CATEGORY[entry.category] ?? Activity,
		actor: entry.actor ?? undefined,
		// With an actor, the phrase trails the bold name; without one, it stands
		// alone, so capitalize it.
		description: entry.actor
			? phrase
			: phrase.charAt(0).toUpperCase() + phrase.slice(1),
		time: formatRelativeTime(entry.createdAt),
	};
}

function SettingsActivity() {
	const query = useSuspenseInfiniteQuery(orgActivityQueryOptions());
	const items = query.data.pages.flat().map(toActivityItem);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Activity</CardTitle>
				<CardDescription>
					Recent actions across this organization.
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
