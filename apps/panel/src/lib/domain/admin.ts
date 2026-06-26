// Admin (platform) domain types — the cross-org views only the /admin console
// renders. Client-safe: no secrets, no Polar ids, no raw image strings. The
// concrete seed data lives in `lib/stubs/admin.ts`.

import type { BillingState } from "@/lib/domain/billing";
import type { NodeRow } from "@/lib/domain/nodes";

export type MemberRole = "owner" | "admin" | "member";

/** One org's billing, for the admin cross-org dashboard + billing table. */
export type AdminBillingRow = {
	orgId: string;
	orgName: string;
	billing: BillingState;
};

/**
 * A user's **platform-wide** role — distinct from the per-org `MemberRole` in
 * their memberships. `admin` is the global superadmin capability the /admin
 * console gates on (Better Auth's admin plugin role), NOT org ownership.
 */
export type PlatformAdminRole = "user" | "admin";

/** Account standing, platform-wide (not per-org). */
export type AdminUserStatus = "active" | "invited" | "suspended";

/** A user's place in one org. */
export type AdminMembership = {
	orgId: string;
	orgName: string;
	role: MemberRole;
};

/**
 * The client-safe view of a platform user — the real data layer's projection
 * (`src/server/users`), which the admin user panel reads/edits. Timestamps are
 * ISO 8601 — the UI formats them. Status comes only as `active` | `suspended`
 * from real data (`invited` would be a pending invitation, not a user row).
 */
export type AdminUserRow = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	emailVerified: boolean;
	/** Platform role (see {@link PlatformAdminRole}) — NOT the per-org membership role. */
	role: PlatformAdminRole;
	status: AdminUserStatus;
	/** ISO 8601 — when the account was created. */
	createdAt: string;
	/** ISO 8601 of the most recent session activity, or null if none on record. */
	lastSeenAt: string | null;
	memberships: AdminMembership[];
};

/**
 * The **wired**, client-safe view of a platform organization — the real data
 * layer's projection (`src/server/orgs`). Carries the real org identity the
 * admin orgs panel reads/edits plus the counts it derives from real tables.
 * `createdAt` is ISO 8601 — the UI formats it; `memberCount`/`nodeCount` come
 * from the `member` and `node` tables.
 */
export type AdminOrgRow = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	/** ISO 8601 — when the organization was created. */
	createdAt: string;
	memberCount: number;
	nodeCount: number;
};

/**
 * One member of an organization (the admin orgs members view). Client-safe — the
 * joined user's display fields plus their per-org `role` (NOT the platform role).
 * `id` is the membership row id; `joinedAt` is ISO 8601.
 */
export type AdminOrgMember = {
	/** The membership row id. */
	id: string;
	userId: string;
	name: string;
	email: string;
	image: string | null;
	role: MemberRole;
	/** ISO 8601 — when the user joined this organization. */
	joinedAt: string;
};

/**
 * One linked OAuth login on an account (the admin connections view). Client-safe
 * — the provider key only, never the stored tokens. `credential` (email/password)
 * rows are excluded by the service; this is the social-login list.
 */
export type AdminUserConnection = {
	id: string;
	/** The provider key, e.g. "google" | "github". */
	providerId: string;
	/** ISO 8601 — when the login was linked. */
	linkedAt: string;
};

/**
 * One active session for a user (the admin sessions view). Client-safe — the
 * session token never leaves the server; the row is keyed by its `id`, and the
 * admin's own current session is flagged so it reads as "this device".
 */
export type AdminUserSession = {
	id: string;
	/** Source IP, or null if it wasn't recorded. */
	ipAddress: string | null;
	/** Raw user-agent string (the UI derives a friendly device label), or null. */
	userAgent: string | null;
	/** ISO 8601 — when the session was opened. */
	createdAt: string;
	/** ISO 8601 — when the session expires. */
	expiresAt: string;
	/** True when this is the requesting admin's own current session. */
	isCurrent: boolean;
};

/** A node in the platform fleet, attributed to the org that owns it. Everything
 * else is the same daemon-derived shape the org app already renders. */
export type AdminNode = NodeRow & { orgId: string; orgName: string };

export type SubdomainStatus = "active" | "pending" | "error";
export type SubdomainRecordType = "A" | "AAAA" | "CNAME";

/** A panel-minted DNS record for a managed node (the platform owns the zone). */
export type Subdomain = {
	id: string;
	/** Full hostname, e.g. `atlas.acme.raptorpanel.app`. */
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
