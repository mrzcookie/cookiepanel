// Platform-wide seed data for the still-stubbed /admin surfaces (UI-first phase):
// the fleet those orgs run (cross-org nodes), the panel-minted subdomains for the
// managed nodes, and 12 months of trend points for the overview charts. The users,
// orgs, billing, and activity feeds are wired to the real data layer now; what
// remains here is replaced as those surfaces land. Everything here is client-safe.

import type { AdminNode, MonthlyMetric, Subdomain } from "@/lib/domain/admin";

const GiB = 1024 ** 3;

// Org id + name for the still-stubbed admin surfaces (nodes, subdomains, charts).
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
