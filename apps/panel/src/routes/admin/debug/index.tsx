import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HardDrive } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { EntityIdentity } from "@/components/shared/entity-card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { debugNodesQueryOptions } from "@/lib/debug-queries";
import { nodeStatus } from "@/lib/status";

export const Route = createFileRoute("/admin/debug/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(debugNodesQueryOptions()),
	component: AdminDebug,
});

function AdminDebug() {
	const { data: nodes } = useSuspenseQuery(debugNodesQueryOptions());

	return (
		<>
			<PageHeader
				description="Per-node connectivity, TLS, and heartbeat health for your organization's fleet — a live diagnostics readout dialed straight from the daemon."
				eyebrow="diagnostics"
				title="Debug"
			/>
			<AdminList
				emptyDescription="Connect a node to see its daemon diagnostics here."
				emptyTitle="No nodes"
				filter={(node, q) =>
					node.name.toLowerCase().includes(q) ||
					node.fqdn.toLowerCase().includes(q)
				}
				head={
					<TableRow>
						<TableHead>Node</TableHead>
						<TableHead>TLS</TableHead>
						<TableHead>Daemon</TableHead>
						<TableHead className="text-right">Last heartbeat</TableHead>
						<TableHead className="text-right">Status</TableHead>
						<TableHead className="text-right">Connectivity</TableHead>
					</TableRow>
				}
				icon={HardDrive}
				items={nodes}
				row={(node) => {
					const conn = node.connectivity;
					return (
						<TableRow key={node.id}>
							<TableCell>
								<EntityIdentity
									icon={HardDrive}
									subtitle={`${node.fqdn}:${node.daemonPort}`}
									subtitleMono
									title={node.name}
								/>
							</TableCell>
							<TableCell className="font-mono text-xs">
								<span
									className={
										node.tlsMode === "unknown"
											? "text-muted-foreground"
											: "text-foreground uppercase"
									}
								>
									{node.tlsMode === "unknown" ? "—" : node.tlsMode}
								</span>
								{node.certFingerprintPrefix ? (
									<span className="ml-2 text-muted-foreground/70">
										{node.certFingerprintPrefix}…
									</span>
								) : null}
							</TableCell>
							<TableCell>
								<div className="flex items-center gap-2">
									<span className="font-mono text-muted-foreground text-xs">
										{node.daemonVersion ?? "—"}
									</span>
									{node.updateAvailable ? (
										<StatusIndicator
											status={{ label: "Update", tone: "pending" }}
										/>
									) : null}
								</div>
							</TableCell>
							<TableCell
								className="text-right text-muted-foreground tabular-nums"
								suppressHydrationWarning
							>
								{node.lastHeartbeat ?? "—"}
							</TableCell>
							<TableCell className="text-right">
								<StatusIndicator
									live={node.status === "pending"}
									status={nodeStatus(node.status)}
								/>
							</TableCell>
							<TableCell className="text-right">
								<span
									className="inline-flex items-center justify-end gap-2"
									title={conn.ok ? undefined : conn.error}
								>
									{conn.ok ? (
										<span className="text-muted-foreground text-xs tabular-nums">
											{conn.latencyMs}ms
										</span>
									) : null}
									<StatusIndicator
										status={
											conn.ok
												? { label: "OK", tone: "online" }
												: { label: "Unreachable", tone: "error" }
										}
									/>
								</span>
							</TableCell>
						</TableRow>
					);
				}}
				searchPlaceholder="Search nodes…"
			/>
		</>
	);
}
