import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/layout/error-screen";
import {
	DangerRow,
	DangerRows,
	DangerZoneCard,
} from "@/components/shared/danger-zone";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { membersOf } from "@/lib/domain/admin";
import {
	type BillingState,
	billableNodeCount,
	monthlyTotalCents,
} from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { billingStatus, nodeStatus } from "@/lib/status";
import { useBilling } from "@/lib/stores/billing-store";
import { type Org, useOrgs } from "@/lib/stores/orgs-store";
import { ADMIN_NODES, ADMIN_USERS } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/orgs/$orgId")({
	component: AdminOrgDetail,
});

/** The org's next dated billing event, if any. */
function nextBilling(
	plan: BillingState
): { label: string; value: string } | null {
	switch (plan.status) {
		case "active":
		case "canceled":
			return plan.currentPeriodEnd
				? { label: "Renews", value: plan.currentPeriodEnd }
				: null;
		case "trialing":
			return plan.trialEndsAt
				? { label: "Trial ends", value: plan.trialEndsAt }
				: null;
		case "past_due":
			return plan.graceEndsAt
				? { label: "Grace ends", value: plan.graceEndsAt }
				: null;
		default:
			return null;
	}
}

function AdminOrgDetail() {
	const { orgId } = Route.useParams();
	const org = useOrgs().find((candidate) => candidate.id === orgId);
	const plan = useBilling(orgId);

	if (!org) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/admin/orgs">Back to organizations</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Organization not found"
				tone="muted"
			/>
		);
	}

	return <OrgView org={org} plan={plan} />;
}

function OrgView({ org, plan }: { org: Org; plan: BillingState }) {
	const navigate = useNavigate();
	const members = membersOf(ADMIN_USERS, org.id);
	const nodes = ADMIN_NODES.filter((node) => node.orgId === org.id);
	const renewal = nextBilling(plan);
	const [deleteOpen, setDeleteOpen] = useState(false);

	function remove() {
		setDeleteOpen(false);
		toast.success(`Deleted “${org.name}”.`);
		navigate({ to: "/admin/orgs" });
	}

	return (
		<>
			<PageHeader
				actions={<StatusIndicator status={billingStatus(plan.status)} />}
				back={{ label: "Organizations", to: "/admin/orgs" }}
				description={org.slug}
				title={org.name}
			/>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Details</CardTitle>
						<CardDescription>Identifiers for this tenant.</CardDescription>
					</CardHeader>
					<CardContent>
						<DetailList>
							<DetailRow copyable label="Organization ID" value={org.id} />
							<DetailRow copyable label="Slug" value={org.slug} />
							<DetailRow label="Members" value={String(members.length)} />
							<DetailRow label="Nodes" value={String(nodes.length)} />
						</DetailList>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Billing</CardTitle>
						<CardDescription>Plan and revenue for this tenant.</CardDescription>
					</CardHeader>
					<CardContent>
						<DetailList>
							<DetailRow
								label="Plan"
								value={billingStatus(plan.status).label}
							/>
							<DetailRow
								label="MRR"
								value={`${formatMoney(monthlyTotalCents(plan))} / mo`}
							/>
							<DetailRow
								label="Nodes billed"
								value={`${billableNodeCount(plan)} of ${plan.nodeCount}`}
							/>
							{renewal ? (
								<DetailRow label={renewal.label} value={renewal.value} />
							) : null}
							<DetailRow
								label="Billing contact"
								value={plan.billingContact?.email ?? "—"}
							/>
						</DetailList>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Members</CardTitle>
					<CardDescription>
						{pluralize(members.length, "person")} in this organization.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{members.length === 0 ? (
						<p className="text-muted-foreground text-sm">No members.</p>
					) : (
						<ul className="divide-y">
							{members.map(({ user, role }) => (
								<li
									className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
									key={user.id}
								>
									<div className="min-w-0">
										<Link
											className="font-medium text-sm hover:underline"
											params={{ userId: user.id }}
											to="/admin/users/$userId"
										>
											{user.name}
										</Link>
										<div className="truncate text-muted-foreground text-xs">
											{user.email}
										</div>
									</div>
									<Badge className="capitalize" variant="secondary">
										{role}
									</Badge>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Nodes</CardTitle>
					<CardDescription>
						{pluralize(nodes.length, "node")} owned by this organization.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{nodes.length === 0 ? (
						<p className="text-muted-foreground text-sm">No nodes.</p>
					) : (
						<ul className="divide-y">
							{nodes.map((node) => (
								<li
									className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
									key={node.id}
								>
									<div className="min-w-0">
										<Link
											className="font-medium text-sm hover:underline"
											params={{ nodeId: node.id }}
											to="/admin/nodes/$nodeId"
										>
											{node.name}
										</Link>
										<div className="truncate font-mono text-muted-foreground text-xs">
											{node.fqdn}
										</div>
									</div>
									<StatusIndicator status={nodeStatus(node.status)} />
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<DangerZoneCard description="Removing an organization affects all of its members.">
				<DangerRows>
					<DangerRow
						action={
							<Button
								onClick={() => setDeleteOpen(true)}
								size="sm"
								variant="destructive"
							>
								Delete
							</Button>
						}
						description="Permanently delete this organization, its nodes, servers, and templates for everyone. This can't be undone."
						title="Delete organization"
					/>
				</DangerRows>
			</DangerZoneCard>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this organization?</DialogTitle>
						<DialogDescription>
							This permanently deletes “{org.name}” along with its nodes,
							servers, and templates, for every member. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button onClick={remove} variant="destructive">
							Delete organization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
