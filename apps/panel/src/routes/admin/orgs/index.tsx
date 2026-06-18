import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { AdminList } from "@/components/admin/admin-list";
import { AdminOrgSheet } from "@/components/admin/admin-org-sheet";
import { PageHeader } from "@/components/shared/page-header";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { adminOrgsQueryOptions } from "@/lib/admin-orgs-queries";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/orgs/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminOrgsQueryOptions()),
	component: AdminOrgs,
});

function AdminOrgs() {
	const { data: orgs } = useSuspenseQuery(adminOrgsQueryOptions());
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Derive the selection from the live list so it stays fresh after a mutation
	// invalidates the cache; a deleted org simply falls out and the sheet closes.
	const selected = orgs.find((org) => org.id === selectedId) ?? null;

	return (
		<>
			<PageHeader
				description="Every tenant on the platform — search, inspect members, and manage each organization."
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
						<TableHead className="text-right">Created</TableHead>
					</TableRow>
				}
				icon={Building2}
				items={orgs}
				row={(org) => (
					<TableRow
						className="cursor-pointer"
						key={org.id}
						onClick={() => setSelectedId(org.id)}
					>
						<TableCell>
							<div className="flex items-center gap-3">
								<div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
									{org.logo ? (
										<img
											alt=""
											className="size-full object-cover"
											src={org.logo}
										/>
									) : (
										<Building2 className="size-4 text-muted-foreground" />
									)}
								</div>
								<div className="min-w-0">
									<div className="font-medium">{org.name}</div>
									<div className="truncate font-mono text-muted-foreground text-xs">
										{org.slug}
									</div>
								</div>
							</div>
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{org.memberCount}
						</TableCell>
						<TableCell
							className={cn(
								"text-right tabular-nums",
								org.nodeCount === 0
									? "text-muted-foreground"
									: "text-foreground"
							)}
						>
							{org.nodeCount === 0 ? "—" : org.nodeCount}
						</TableCell>
						<TableCell
							className="text-right text-muted-foreground tabular-nums"
							suppressHydrationWarning
						>
							{formatDate(org.createdAt)}
						</TableCell>
					</TableRow>
				)}
				searchPlaceholder="Search organizations…"
			/>
			<AdminOrgSheet
				onOpenChange={(open) => {
					if (!open) {
						setSelectedId(null);
					}
				}}
				org={selected}
			/>
		</>
	);
}
