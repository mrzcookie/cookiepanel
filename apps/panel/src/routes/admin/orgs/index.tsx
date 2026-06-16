import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { membersOf } from "@/lib/domain/admin";
import { monthlyTotalCents } from "@/lib/domain/billing";
import { formatMoney } from "@/lib/format";
import { billingStatus } from "@/lib/status";
import { EMPTY_STATE, useAllBilling } from "@/lib/stores/billing-store";
import { useOrgs } from "@/lib/stores/orgs-store";
import { ADMIN_NODES, ADMIN_USERS } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/orgs/")({
	component: AdminOrgs,
});

function AdminOrgs() {
	const orgs = useOrgs();
	const billing = useAllBilling();

	return (
		<>
			<PageHeader
				description="Every tenant on the platform — members, plan, and the nodes they run."
				eyebrow="tenants"
				title="Organizations"
			/>
			<AdminList
				emptyDescription="No tenants yet."
				emptyTitle="No organizations"
				filter={(org, q) =>
					org.name.toLowerCase().includes(q) ||
					org.slug.toLowerCase().includes(q)
				}
				head={
					<TableRow>
						<TableHead>Organization</TableHead>
						<TableHead className="text-right">Members</TableHead>
						<TableHead className="text-right">Nodes</TableHead>
						<TableHead className="text-right">MRR</TableHead>
						<TableHead className="text-right">Status</TableHead>
					</TableRow>
				}
				icon={Building2}
				items={orgs}
				row={(org) => {
					const plan = billing[org.id] ?? EMPTY_STATE;
					const members = membersOf(ADMIN_USERS, org.id).length;
					const nodes = ADMIN_NODES.filter(
						(node) => node.orgId === org.id
					).length;
					return (
						<TableRow key={org.id}>
							<TableCell>
								<Link
									className="font-medium hover:underline"
									params={{ orgId: org.id }}
									to="/admin/orgs/$orgId"
								>
									{org.name}
								</Link>
								<div className="font-mono text-muted-foreground text-xs">
									{org.slug}
								</div>
							</TableCell>
							<TableCell className="text-right text-muted-foreground tabular-nums">
								{members}
							</TableCell>
							<TableCell className="text-right text-muted-foreground tabular-nums">
								{nodes === 0 ? "—" : nodes}
							</TableCell>
							<TableCell className="text-right font-mono tabular-nums">
								{formatMoney(monthlyTotalCents(plan))}
							</TableCell>
							<TableCell className="text-right">
								<StatusIndicator status={billingStatus(plan.status)} />
							</TableCell>
						</TableRow>
					);
				}}
				searchPlaceholder="Search organizations…"
			/>
		</>
	);
}
