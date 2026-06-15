// Platform-wide seed data for the /admin console (UI-first phase). One coherent
// dataset: the same four orgs as the org switcher + billing, the users that
// belong to them, the fleet those orgs run (node counts match each org's billing
// seat count), the panel-minted subdomains for the managed nodes, the audit
// feed, and 12 months of trend points for the overview charts. Replaced by the
// data layer; everything here is client-safe.

import {
	Archive,
	Building2,
	CreditCard,
	Globe,
	HardDrive,
	LayoutTemplate,
	Server,
	Trash2,
	UserPlus,
	UserX,
} from "lucide-react";
import type {
	AdminActivityEntry,
	AdminMembership,
	AdminNode,
	AdminUser,
	MemberRole,
	MonthlyMetric,
	Subdomain,
} from "@/lib/domain/admin";

const GiB = 1024 ** 3;

// Org id + name, mirroring lib/stores/orgs-store + lib/stores/billing-store.
const ORG = {
	acme: { id: "7c9e6a52-3f1b-4d8a-9e2c-1a4b6d8f0e21", name: "Acme Gaming" },
	northwind: {
		id: "b3d8f1a4-6c2e-4a90-8b15-7e0c3d9f2a64",
		name: "Northwind Servers",
	},
	pixelforge: {
		id: "c4e9a2b5-7d3f-4b01-9c26-8f1d4e0a3b75",
		name: "Pixelforge Collective",
	},
	lonePine: {
		id: "d5f0b3c6-8e4a-4c12-8d37-9a2e5f1b4c86",
		name: "Lone Pine Studio",
	},
} as const;

/** Build a membership from an ORG entry (keys `orgId`/`orgName`, not `id`/`name`). */
function m(
	org: { id: string; name: string },
	role: MemberRole
): AdminMembership {
	return { orgId: org.id, orgName: org.name, role };
}

// ─── Users ───────────────────────────────────────────────────────────────────

export const ADMIN_USERS: AdminUser[] = [
	{
		id: "11111111-0001-4a00-8a00-000000000001",
		name: "Jane Cooper",
		email: "jane@example.com",
		status: "active",
		memberships: [m(ORG.acme, "owner")],
		joinedAt: "May 1, 2026",
		lastSeenAt: "Just now",
	},
	{
		id: "11111111-0002-4a00-8a00-000000000002",
		name: "Marco Diaz",
		email: "marco@example.com",
		status: "active",
		memberships: [m(ORG.acme, "admin")],
		joinedAt: "May 3, 2026",
		lastSeenAt: "2 hours ago",
	},
	{
		id: "11111111-0003-4a00-8a00-000000000003",
		name: "Aisha Khan",
		email: "aisha@acme.example",
		status: "active",
		memberships: [m(ORG.acme, "member")],
		joinedAt: "May 14, 2026",
		lastSeenAt: "Yesterday",
	},
	{
		id: "11111111-0004-4a00-8a00-000000000004",
		name: "Elena Rossi",
		email: "elena@example.com",
		status: "active",
		memberships: [m(ORG.acme, "member"), m(ORG.northwind, "member")],
		joinedAt: "May 20, 2026",
		lastSeenAt: "3 hours ago",
	},
	{
		id: "11111111-0005-4a00-8a00-000000000005",
		name: "Priya Patel",
		email: "priya@northwind.example",
		status: "active",
		memberships: [m(ORG.northwind, "owner")],
		joinedAt: "Jun 2, 2026",
		lastSeenAt: "Yesterday",
	},
	{
		id: "11111111-0006-4a00-8a00-000000000006",
		name: "Tom Becker",
		email: "tom@northwind.example",
		status: "active",
		memberships: [m(ORG.northwind, "member")],
		joinedAt: "Jun 3, 2026",
		lastSeenAt: "5 days ago",
	},
	{
		id: "11111111-0007-4a00-8a00-000000000007",
		name: "Liam Chen",
		email: "liam@pixelforge.example",
		status: "active",
		memberships: [m(ORG.pixelforge, "owner")],
		joinedAt: "Jun 11, 2026",
		lastSeenAt: "Yesterday",
	},
	{
		id: "11111111-0008-4a00-8a00-000000000008",
		name: "Sofia Marquez",
		email: "sofia@pixelforge.example",
		status: "active",
		memberships: [m(ORG.pixelforge, "admin")],
		joinedAt: "Jun 11, 2026",
		lastSeenAt: "4 hours ago",
	},
	{
		id: "11111111-0009-4a00-8a00-000000000009",
		name: "Dustin Carver",
		email: "dustin@pixelforge.example",
		status: "active",
		memberships: [m(ORG.pixelforge, "member")],
		joinedAt: "Jun 12, 2026",
		lastSeenAt: "2 days ago",
	},
	{
		id: "11111111-0010-4a00-8a00-000000000010",
		name: "Noah Williams",
		email: "noah@lonepine.example",
		status: "active",
		memberships: [m(ORG.lonePine, "owner")],
		joinedAt: "Jun 13, 2026",
		lastSeenAt: "6 hours ago",
	},
	{
		id: "11111111-0011-4a00-8a00-000000000011",
		name: "Owen Fletcher",
		email: "owen@acme.example",
		status: "invited",
		memberships: [m(ORG.acme, "member")],
		joinedAt: "Jun 10, 2026",
		lastSeenAt: null,
	},
	{
		id: "11111111-0012-4a00-8a00-000000000012",
		name: "Reza Akbari",
		email: "dev@spam-co.example",
		status: "suspended",
		memberships: [],
		joinedAt: "Jun 6, 2026",
		lastSeenAt: "Jun 8, 2026",
	},
];

// ─── Fleet (node counts match each org's billing seat count) ──────────────────

type NodeSeed = Partial<AdminNode> &
	Pick<AdminNode, "id" | "name" | "fqdn" | "orgId" | "orgName">;

const NODE_DEFAULTS = {
	daemonPort: 8443,
	managed: false,
	status: "online",
	publicIp: "203.0.113.1",
	os: "Ubuntu 24.04 LTS",
	arch: "x86_64",
	cpuCores: 8,
	memTotalBytes: 32 * GiB,
	diskTotalBytes: 512 * GiB,
	cpuPercent: 22,
	memUsedBytes: 11 * GiB,
	diskUsedBytes: 180 * GiB,
	serversRunning: 2,
	serversTotal: 3,
	daemonVersion: "1.4.2",
	updateAvailable: false,
	lastHeartbeat: "Just now",
	caps: { cpuCores: 8, memBytes: 32 * GiB, diskBytes: 512 * GiB },
} satisfies Omit<AdminNode, "id" | "name" | "fqdn" | "orgId" | "orgName">;

function node(seed: NodeSeed): AdminNode {
	return { ...NODE_DEFAULTS, ...seed };
}

export const ADMIN_NODES: AdminNode[] = [
	// Acme Gaming — 6 nodes (active plan).
	node({
		id: "a0000000-0001-4a00-8a00-0000000000a1",
		name: "atlas",
		fqdn: "atlas.acme.cookiepanel.app",
		managed: true,
		publicIp: "203.0.113.10",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	node({
		id: "a0000000-0002-4a00-8a00-0000000000a2",
		name: "valhalla",
		fqdn: "valhalla.acme.cookiepanel.app",
		managed: true,
		publicIp: "203.0.113.11",
		cpuPercent: 41,
		memUsedBytes: 19 * GiB,
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	node({
		id: "a0000000-0003-4a00-8a00-0000000000a3",
		name: "nimbus",
		fqdn: "nimbus.acme.cookiepanel.app",
		managed: true,
		publicIp: "203.0.113.12",
		daemonVersion: "1.4.0",
		updateAvailable: true,
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	node({
		id: "a0000000-0004-4a00-8a00-0000000000a4",
		name: "orion",
		fqdn: "orion.acme.cookiepanel.app",
		managed: true,
		status: "unhealthy",
		publicIp: "203.0.113.13",
		cpuPercent: 96,
		memUsedBytes: 30 * GiB,
		diskUsedBytes: 470 * GiB,
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	node({
		id: "a0000000-0005-4a00-8a00-0000000000a5",
		name: "titan",
		fqdn: "titan.acme.example.com",
		publicIp: "198.51.100.5",
		cpuCores: 16,
		memTotalBytes: 64 * GiB,
		diskTotalBytes: 1024 * GiB,
		caps: { cpuCores: 16, memBytes: 64 * GiB, diskBytes: 1024 * GiB },
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	node({
		id: "a0000000-0006-4a00-8a00-0000000000a6",
		name: "web-01",
		fqdn: "web-01.acme.example.com",
		status: "offline",
		publicIp: "198.51.100.6",
		cpuPercent: null,
		memUsedBytes: null,
		diskUsedBytes: null,
		serversRunning: null,
		serversTotal: 1,
		lastHeartbeat: "2 hours ago",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
	}),
	// Northwind Servers — 1 node (trialing).
	node({
		id: "b0000000-0001-4a00-8a00-0000000000b1",
		name: "eu-west-01",
		fqdn: "eu-west-01.northwind.cookiepanel.app",
		managed: true,
		publicIp: "198.51.100.20",
		serversRunning: 1,
		serversTotal: 1,
		orgId: ORG.northwind.id,
		orgName: ORG.northwind.name,
	}),
	// Pixelforge Collective — 3 nodes (past due).
	node({
		id: "c0000000-0001-4a00-8a00-0000000000c1",
		name: "pf-1",
		fqdn: "pf-1.pixelforge.cookiepanel.app",
		managed: true,
		publicIp: "192.0.2.30",
		orgId: ORG.pixelforge.id,
		orgName: ORG.pixelforge.name,
	}),
	node({
		id: "c0000000-0002-4a00-8a00-0000000000c2",
		name: "pf-2",
		fqdn: "pf-2.pixelforge.example.com",
		publicIp: "192.0.2.31",
		cpuPercent: 8,
		serversRunning: 1,
		orgId: ORG.pixelforge.id,
		orgName: ORG.pixelforge.name,
	}),
	node({
		id: "c0000000-0003-4a00-8a00-0000000000c3",
		name: "pf-3",
		fqdn: "pf-3.pixelforge.cookiepanel.app",
		managed: true,
		status: "pending",
		publicIp: null,
		os: null,
		arch: null,
		cpuCores: null,
		memTotalBytes: null,
		diskTotalBytes: null,
		cpuPercent: null,
		memUsedBytes: null,
		diskUsedBytes: null,
		serversRunning: null,
		serversTotal: null,
		daemonVersion: null,
		lastHeartbeat: null,
		caps: null,
		orgId: ORG.pixelforge.id,
		orgName: ORG.pixelforge.name,
	}),
];

// ─── Subdomains (panel-minted DNS for the managed nodes) ──────────────────────

export const SUBDOMAINS: Subdomain[] = [
	{
		id: "5b000000-0001-4a00-8a00-0000000000d1",
		hostname: "atlas.acme.cookiepanel.app",
		recordType: "A",
		target: "203.0.113.10",
		status: "active",
		nodeId: "a0000000-0001-4a00-8a00-0000000000a1",
		nodeName: "atlas",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
		createdAt: "May 2, 2026",
	},
	{
		id: "5b000000-0002-4a00-8a00-0000000000d2",
		hostname: "valhalla.acme.cookiepanel.app",
		recordType: "A",
		target: "203.0.113.11",
		status: "active",
		nodeId: "a0000000-0002-4a00-8a00-0000000000a2",
		nodeName: "valhalla",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
		createdAt: "May 4, 2026",
	},
	{
		id: "5b000000-0003-4a00-8a00-0000000000d3",
		hostname: "nimbus.acme.cookiepanel.app",
		recordType: "A",
		target: "203.0.113.12",
		status: "active",
		nodeId: "a0000000-0003-4a00-8a00-0000000000a3",
		nodeName: "nimbus",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
		createdAt: "May 9, 2026",
	},
	{
		id: "5b000000-0004-4a00-8a00-0000000000d4",
		hostname: "orion.acme.cookiepanel.app",
		recordType: "A",
		target: "203.0.113.13",
		status: "error",
		nodeId: "a0000000-0004-4a00-8a00-0000000000a4",
		nodeName: "orion",
		orgId: ORG.acme.id,
		orgName: ORG.acme.name,
		createdAt: "May 18, 2026",
	},
	{
		id: "5b000000-0005-4a00-8a00-0000000000d5",
		hostname: "eu-west-01.northwind.cookiepanel.app",
		recordType: "A",
		target: "198.51.100.20",
		status: "active",
		nodeId: "b0000000-0001-4a00-8a00-0000000000b1",
		nodeName: "eu-west-01",
		orgId: ORG.northwind.id,
		orgName: ORG.northwind.name,
		createdAt: "Jun 2, 2026",
	},
	{
		id: "5b000000-0006-4a00-8a00-0000000000d6",
		hostname: "pf-1.pixelforge.cookiepanel.app",
		recordType: "A",
		target: "192.0.2.30",
		status: "active",
		nodeId: "c0000000-0001-4a00-8a00-0000000000c1",
		nodeName: "pf-1",
		orgId: ORG.pixelforge.id,
		orgName: ORG.pixelforge.name,
		createdAt: "Jun 11, 2026",
	},
	{
		id: "5b000000-0007-4a00-8a00-0000000000d7",
		hostname: "pf-3.pixelforge.cookiepanel.app",
		recordType: "A",
		target: "192.0.2.32",
		status: "pending",
		nodeId: "c0000000-0003-4a00-8a00-0000000000c3",
		nodeName: "pf-3",
		orgId: ORG.pixelforge.id,
		orgName: ORG.pixelforge.name,
		createdAt: "Jun 14, 2026",
	},
];

// ─── Audit feed ──────────────────────────────────────────────────────────────

export const ADMIN_ACTIVITY: AdminActivityEntry[] = [
	{
		id: "ac-1",
		icon: LayoutTemplate,
		actor: "Jane Cooper",
		description: "published the official template “Valheim Dedicated” (v3)",
		time: "11 minutes ago",
		scope: "platform",
	},
	{
		id: "ac-2",
		icon: Server,
		actor: "Marco Diaz",
		description: "created server “mc-survival” in Acme Gaming",
		time: "40 minutes ago",
		scope: "tenant",
	},
	{
		id: "ac-3",
		icon: UserX,
		actor: "Jane Cooper",
		description: "suspended the account dev@spam-co.example",
		time: "2 hours ago",
		scope: "platform",
	},
	{
		id: "ac-4",
		icon: CreditCard,
		actor: "Pixelforge Collective",
		description: "payment failed — the account entered its grace window",
		time: "5 hours ago",
		scope: "tenant",
	},
	{
		id: "ac-5",
		icon: Globe,
		actor: "Jane Cooper",
		description: "minted the subdomain eu-west-01.northwind.cookiepanel.app",
		time: "Yesterday",
		scope: "platform",
	},
	{
		id: "ac-6",
		icon: HardDrive,
		actor: "Priya Patel",
		description: "connected node “eu-west-01” in Northwind Servers",
		time: "Yesterday",
		scope: "tenant",
	},
	{
		id: "ac-7",
		icon: Archive,
		actor: "Jane Cooper",
		description: "archived the official template “CS:GO Legacy”",
		time: "Jun 12, 2026",
		scope: "platform",
	},
	{
		id: "ac-8",
		icon: Building2,
		actor: "Liam Chen",
		description: "created the organization “Pixelforge Collective”",
		time: "Jun 11, 2026",
		scope: "tenant",
	},
	{
		id: "ac-9",
		icon: UserPlus,
		actor: "Marco Diaz",
		description: "invited owen@acme.example to Acme Gaming",
		time: "Jun 10, 2026",
		scope: "tenant",
	},
	{
		id: "ac-10",
		icon: Trash2,
		actor: "Jane Cooper",
		description: "removed the organization “Defunct LLC” and its 2 nodes",
		time: "Jun 9, 2026",
		scope: "platform",
	},
];

// ─── Trends (12 months; users/orgs cumulative, revenue = that month's MRR) ────

export const MONTHLY: MonthlyMetric[] = [
	{ month: "Jul", mrrCents: 0, users: 2, orgs: 1 },
	{ month: "Aug", mrrCents: 1000, users: 3, orgs: 1 },
	{ month: "Sep", mrrCents: 1000, users: 3, orgs: 2 },
	{ month: "Oct", mrrCents: 2000, users: 4, orgs: 2 },
	{ month: "Nov", mrrCents: 2000, users: 5, orgs: 2 },
	{ month: "Dec", mrrCents: 3000, users: 6, orgs: 3 },
	{ month: "Jan", mrrCents: 4000, users: 7, orgs: 3 },
	{ month: "Feb", mrrCents: 5000, users: 9, orgs: 3 },
	{ month: "Mar", mrrCents: 6000, users: 10, orgs: 4 },
	{ month: "Apr", mrrCents: 7000, users: 11, orgs: 4 },
	{ month: "May", mrrCents: 8000, users: 12, orgs: 4 },
	{ month: "Jun", mrrCents: 9000, users: 12, orgs: 4 },
];
