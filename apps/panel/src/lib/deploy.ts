// Pure, client-safe helpers for deploying a server from a template: node
// capacity readouts, sensible starting limits bounded by a node's allocatable
// caps, and a conventional starting port. No React, no stores — the wizard and
// the use-template dialog share these so a deploy reads the same everywhere.

import { formatBytes } from "@/lib/format";
import type { NodeRow } from "@/lib/stubs";
import type { Template } from "@/lib/templates";

export const GiB = 1024 ** 3;

/** Only online or unhealthy nodes can accept a new server. */
export function isDeployTarget(node: NodeRow): boolean {
	return node.status === "online" || node.status === "unhealthy";
}

/** A node's detected hardware in one line, omitting parts not yet reported. */
export function capacityLabel(node: NodeRow): string | null {
	const parts: string[] = [];
	if (node.cpuCores != null) {
		parts.push(`${node.cpuCores} vCPU`);
	}
	if (node.memTotalBytes != null) {
		parts.push(formatBytes(node.memTotalBytes));
	}
	return parts.length ? parts.join(" · ") : null;
}

export type ServerCaps = {
	cpuCores: number;
	memGb: number;
	diskGb: number;
};

/**
 * Allocatable ceilings for a server on this node, as whole units. Falls back to
 * detected hardware, then to generous maxes, so the limit fields always have
 * bounds even on an unhealthy node that hasn't reported caps.
 */
export function serverCaps(node: NodeRow): ServerCaps {
	const cpu = node.caps?.cpuCores ?? node.cpuCores ?? 64;
	const mem = node.caps?.memBytes ?? node.memTotalBytes ?? 512 * GiB;
	const disk = node.caps?.diskBytes ?? node.diskTotalBytes ?? 4096 * GiB;
	return {
		cpuCores: Math.max(1, Math.floor(cpu)),
		memGb: Math.max(1, Math.floor(mem / GiB)),
		diskGb: Math.max(1, Math.floor(disk / GiB)),
	};
}

/** Sensible starting limits for a new server, clamped to the node's caps. */
export function defaultLimits(node: NodeRow): ServerCaps {
	const caps = serverCaps(node);
	return {
		cpuCores: Math.min(2, caps.cpuCores),
		memGb: Math.min(4, caps.memGb),
		diskGb: Math.min(20, caps.diskGb),
	};
}

export function clampInt(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

// A conventional starting port by template category. The wizard scans upward
// from here for the first free slot on the chosen node.
const CATEGORY_PORT: Record<string, number> = {
	Minecraft: 25565,
	FPS: 27015,
	Voice: 9987,
};

export function basePortFor(template: Template): number {
	return CATEGORY_PORT[template.category] ?? 27015;
}
