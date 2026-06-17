// Activity-log domain types (client-safe DATA). The UI maps an `ActivityEntry`
// to the presentational `ActivityItem` (choosing an icon per category and
// formatting the relative time) — those are UI concerns, kept out of here.

export type ActivityCategory =
	| "auth"
	| "account"
	| "organization"
	| "member"
	| "node"
	| "server"
	| "network"
	| "template"
	| "billing";

export type ActivityEntry = {
	id: string;
	category: ActivityCategory;
	/** Stable action key, e.g. "login", "node.created", "member.invited". */
	action: string;
	/** The actor's user id, or null for system actions. */
	actorId: string | null;
	/** The actor's display name captured at write time, when available. */
	actor: string | null;
	/** Friendly label of the thing acted on (e.g. a node name). */
	target: string | null;
	targetType: string | null;
	targetId: string | null;
	ip: string | null;
	/** ISO 8601; the UI formats the relative time. */
	createdAt: string;
};
