import { createServerFn } from "@tanstack/react-start";
import type { AdminBillingRow } from "@/lib/domain/admin";
import { orgsRepository } from "@/server/admin/orgs/repository";
import { requirePlatformAdmin } from "@/server/auth/guards";
import { projectOrgBilling } from "@/server/billing/projection";

/**
 * Admin cross-org billing — the revenue view spanning every organization, behind
 * the platform-admin gate. A thin `auth + delegate` shim: list the orgs, then
 * project each one's billing through the same `projectOrgBilling` the org-scoped
 * `getBilling` uses, so the admin numbers can't drift from the per-org ones.
 *
 * Projection is per-org (a few cached reads each); fine at admin scale + traffic.
 * Batch it if the org count ever makes the round-trips bite.
 */
export const listAdminBilling = createServerFn({ method: "GET" }).handler(
	async (): Promise<AdminBillingRow[]> => {
		await requirePlatformAdmin();
		const orgs = await orgsRepository.list();
		return Promise.all(
			orgs.map(async (org) => ({
				orgId: org.id,
				orgName: org.name,
				billing: await projectOrgBilling(org.id),
			}))
		);
	}
);
