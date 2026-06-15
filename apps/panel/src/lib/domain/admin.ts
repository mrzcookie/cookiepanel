// Admin (platform) domain types — the cross-org views only the /admin console
// renders. Client-safe: no secrets, no Polar ids, no raw image strings. The
// concrete seed data lives in `lib/stubs/admin.ts`.

import type { LucideIcon } from "lucide-react";
import type { NodeRow } from "@/lib/domain/nodes";

export type MemberRole = "owner" | "admin" | "member";

/** Whether an audit entry is an admin (platform) action or a tenant action. */
export type AdminActivityScope = "platform" | "tenant";

/** One row of the platform audit feed. Superset of the shared ActivityItem, so
 * it renders directly in ActivityList; `scope` drives the feed's filter. */
export type AdminActivityEntry = {
	id: string;
	icon: LucideIcon;
	actor: string;
	description: string;
	time: string;
	scope: AdminActivityScope;
};

/** Account standing, platform-wide (not per-org). */
export type AdminUserStatus = "active" | "invited" | "suspended";

/** A user's place in one org. */
export type AdminMembership = {
	orgId: string;
	orgName: string;
	role: MemberRole;
};

export type AdminUser = {
	id: string;
	name: string;
	email: string;
	status: AdminUserStatus;
	memberships: AdminMembership[];
	/** Pre-formatted for the UI-first phase. */
	joinedAt: string;
	/** Pre-formatted relative time, or null for never (e.g. an open invite). */
	lastSeenAt: string | null;
};

/** A node in the platform fleet, attributed to the org that owns it. Everything
 * else is the same daemon-derived shape the org app already renders. */
export type AdminNode = NodeRow & { orgId: string; orgName: string };

export type SubdomainStatus = "active" | "pending" | "error";
export type SubdomainRecordType = "A" | "AAAA" | "CNAME";

/** A panel-minted DNS record for a managed node (the platform owns the zone). */
export type Subdomain = {
	id: string;
	/** Full hostname, e.g. `atlas.acme.cookiepanel.app`. */
	hostname: string;
	recordType: SubdomainRecordType;
	/** The record's target: an IP (A/AAAA) or a hostname (CNAME). */
	target: string;
	status: SubdomainStatus;
	/** The node it points at — null if that node was removed. */
	nodeId: string | null;
	nodeName: string | null;
	orgId: string;
	orgName: string;
	createdAt: string;
};

/** One month of platform metrics for the overview charts. Users/orgs are
 * cumulative totals (a growth curve); revenue is that month's MRR, in cents. */
export type MonthlyMetric = {
	month: string;
	mrrCents: number;
	users: number;
	orgs: number;
};

// ─── Derivations ─────────────────────────────────────────────────────────────

/** Members of an org, derived from the user list (the single source of truth for
 * membership). Owners first, then admins, then members; each rank alphabetical. */
const ROLE_RANK: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 };

export function membersOf(
	users: AdminUser[],
	orgId: string
): { user: AdminUser; role: MemberRole }[] {
	return users
		.flatMap((user) => {
			const membership = user.memberships.find((m) => m.orgId === orgId);
			return membership ? [{ user, role: membership.role }] : [];
		})
		.sort(
			(a, b) =>
				ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
				a.user.name.localeCompare(b.user.name)
		);
}
