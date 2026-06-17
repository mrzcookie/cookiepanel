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
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allActivityQueryOptions } from "@/lib/activity-queries";
import type { ActivityCategory, ActivityEntry } from "@/lib/domain/activity";
import { formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin/activity")({
	loader: ({ context }) =>
		context.queryClient.ensureInfiniteQueryData(allActivityQueryOptions()),
	component: AdminActivity,
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
 * A third-person verb phrase for one action — the actor name renders separately
 * (bold) ahead of it, so phrases start lowercase ("invited …"); with no actor the
 * caller capitalizes it. Mirrors the org feed: the platform feed spans every org,
 * so the same third-person voice fits. Unmapped actions fall back to a humanized
 * key so a new action still reads sensibly rather than vanishing.
 */
function describe(entry: ActivityEntry): string {
	switch (entry.action) {
		case "login":
			return entry.ip ? `logged in from ${entry.ip}` : "logged in";
		case "organization.created":
			return entry.target
				? `created the organization ${entry.target}`
				: "created the organization";
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
		case "account.updated":
			return entry.target
				? `updated the account ${entry.target}`
				: "updated an account";
		case "account.role_changed":
			return entry.target
				? `changed the platform role of ${entry.target}`
				: "changed an account's platform role";
		case "account.suspended":
			return entry.target
				? `suspended the account ${entry.target}`
				: "suspended an account";
		case "account.reactivated":
			return entry.target
				? `reactivated the account ${entry.target}`
				: "reactivated an account";
		case "account.deleted":
			return entry.target
				? `deleted the account ${entry.target}`
				: "deleted an account";
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

function AdminActivity() {
	const query = useSuspenseInfiniteQuery(allActivityQueryOptions());
	const items = query.data.pages.flat().map(toActivityItem);

	return (
		<>
			<PageHeader
				description="A global audit trail of meaningful actions across every organization."
				eyebrow="audit"
				title="Activity"
			/>

			<Card>
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
		</>
	);
}
