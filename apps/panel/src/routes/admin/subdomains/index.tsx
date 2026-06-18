import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { subdomainStatus } from "@/lib/status";
import { SUBDOMAINS } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/subdomains/")({
	component: AdminSubdomains,
});

function AdminSubdomains() {
	return (
		<>
			<PageHeader
				description="Panel-minted subdomains and their DNS records for managed nodes."
				eyebrow="dns"
				title="Subdomains"
			/>
			<AdminList
				emptyDescription="No panel-minted subdomains yet."
				emptyTitle="No subdomains"
				filter={(record, q) =>
					record.hostname.toLowerCase().includes(q) ||
					record.target.toLowerCase().includes(q) ||
					record.orgName.toLowerCase().includes(q) ||
					(record.nodeName?.toLowerCase().includes(q) ?? false)
				}
				head={
					<TableRow>
						<TableHead>Hostname</TableHead>
						<TableHead>Record</TableHead>
						<TableHead>Target</TableHead>
						<TableHead>Organization</TableHead>
						<TableHead>Node</TableHead>
						<TableHead className="text-right">Status</TableHead>
					</TableRow>
				}
				icon={Globe}
				items={SUBDOMAINS}
				row={(record) => (
					<TableRow key={record.id}>
						<TableCell className="font-mono text-sm">
							{record.hostname}
						</TableCell>
						<TableCell>
							<Badge variant="outline">{record.recordType}</Badge>
						</TableCell>
						<TableCell className="font-mono text-muted-foreground text-xs">
							{record.target}
						</TableCell>
						<TableCell className="text-muted-foreground">
							{record.orgName}
						</TableCell>
						<TableCell>
							{record.nodeId ? (
								<Link
									className="text-muted-foreground hover:underline"
									params={{ nodeId: record.nodeId }}
									to="/admin/nodes/$nodeId"
								>
									{record.nodeName}
								</Link>
							) : (
								<span className="text-muted-foreground">—</span>
							)}
						</TableCell>
						<TableCell className="text-right">
							<StatusIndicator status={subdomainStatus(record.status)} />
						</TableCell>
					</TableRow>
				)}
				searchPlaceholder="Search subdomains…"
			/>
		</>
	);
}
