import {
	Activity,
	Box,
	Building2,
	CreditCard,
	LayoutTemplate,
	LogIn,
	type LucideIcon,
	Network,
	Server,
	UserRound,
	Users,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import type { ActivityCategory, ActivityEntry } from "@/lib/domain/activity";
import { formatRelativeTime } from "@/lib/format";

export type ActivityItem = {
	id: string;
	icon: LucideIcon;
	/** Optional actor name, rendered bold ahead of the description. */
	actor?: string;
	description: string;
	time: string;
};

export function ActivityList({ items }: { items: ActivityItem[] }) {
	if (items.length === 0) {
		return (
			<EmptyState
				description="Recent actions will show up here."
				icon={Activity}
				title="No activity yet"
			/>
		);
	}
	return (
		<ol className="relative">
			{items.map((item, index) => (
				<li className="relative flex gap-4 pb-6 last:pb-0" key={item.id}>
					{/* The timeline rail: a hairline linking each event to the next.
					    Anchored to the chip centers and masked by the opaque chips, so
					    it reads as one continuous line from first event to last. */}
					{index < items.length - 1 ? (
						<span
							aria-hidden
							className="absolute top-4 -bottom-4 left-4 w-px -translate-x-1/2 bg-border"
						/>
					) : null}
					<span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
						<item.icon className="size-4" />
					</span>
					<div className="min-w-0 flex-1 pt-1.5">
						<p className="text-sm">
							{item.actor ? (
								<span className="font-medium">{item.actor} </span>
							) : null}
							{item.description}
						</p>
						<p
							className="mt-1 font-mono text-muted-foreground text-xs tracking-wide"
							suppressHydrationWarning
						>
							{item.time}
						</p>
					</div>
				</li>
			))}
		</ol>
	);
}

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
 * A third-person verb phrase for one action — the actor name renders separately
 * (bold) ahead of it, so phrases start lowercase ("invited …"); with no actor the
 * caller capitalizes it. Spans every org (the platform/admin voice). Unmapped
 * actions fall back to a humanized key so a new action still reads sensibly
 * rather than vanishing.
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
			return entry.target
				? `updated the organization ${entry.target}`
				: "updated the organization";
		case "organization.logo_updated":
			return "updated the organization logo";
		case "organization.logo_removed":
			return "removed the organization logo";
		case "organization.deleted":
			return entry.target
				? `deleted the organization ${entry.target}`
				: "deleted an organization";
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
		case "egg.created":
			return entry.target ? `created the egg ${entry.target}` : "created a egg";
		case "egg.updated":
			return entry.target ? `edited the egg ${entry.target}` : "edited a egg";
		case "egg.published":
			return entry.target
				? `published the egg ${entry.target}`
				: "published a egg";
		case "egg.unpublished":
			return entry.target
				? `moved the egg ${entry.target} back to draft`
				: "unpublished a egg";
		case "egg.archived":
			return entry.target
				? `archived the egg ${entry.target}`
				: "archived a egg";
		case "egg.forked":
			return entry.target
				? `customized the egg ${entry.target}`
				: "customized a egg";
		case "egg.imported":
			return entry.target
				? `imported the egg ${entry.target}`
				: "imported a egg";
		case "egg.deleted":
			return entry.target ? `deleted the egg ${entry.target}` : "deleted a egg";
		default: {
			const phrase = entry.action.replace(/[._]/g, " ");
			return entry.target ? `${phrase}: ${entry.target}` : phrase;
		}
	}
}

/**
 * Map a raw audit `ActivityEntry` to the presentational `ActivityItem` — an icon
 * per category and a verb phrase per action. The platform/admin projection (org
 * actions in third person); the account feed has its own first-person mapping.
 */
export function toActivityItem(entry: ActivityEntry): ActivityItem {
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
