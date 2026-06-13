import { HardDrive } from "lucide-react";
import { EntityIconChip } from "@/components/entity-card";
import { StatusIndicator } from "@/components/status-indicator";
import { capacityLabel, isDeployTarget } from "@/lib/deploy";
import { nodeStatus } from "@/lib/status";
import type { NodeRow } from "@/lib/stubs";
import { cn } from "@/lib/utils";

// The step-2 node picker: a radio list of nodes. Only online or unhealthy nodes
// can take a server; offline / pending nodes show dimmed with their status chip
// explaining why. Selectable nodes sort to the top.
export function NodePicker({
	nodes,
	onSelect,
	selectedId,
}: {
	nodes: NodeRow[];
	onSelect: (id: string) => void;
	selectedId: string | null;
}) {
	const sorted = [...nodes].sort((a, b) => {
		const aTarget = isDeployTarget(a);
		const bTarget = isDeployTarget(b);
		if (aTarget !== bTarget) {
			return aTarget ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	return (
		<fieldset className="flex flex-col gap-2.5">
			<legend className="sr-only">Node</legend>
			{sorted.map((node) => (
				<NodeRowOption
					key={node.id}
					node={node}
					onSelect={onSelect}
					selected={node.id === selectedId}
				/>
			))}
		</fieldset>
	);
}

function NodeRowOption({
	node,
	onSelect,
	selected,
}: {
	node: NodeRow;
	onSelect: (id: string) => void;
	selected: boolean;
}) {
	const selectable = isDeployTarget(node);
	const capacity = capacityLabel(node);
	return (
		<label
			className={cn(
				"flex items-center gap-3 rounded-lg bg-card p-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2",
				selected ? "ring-2 ring-primary" : "ring-1 ring-foreground/10",
				selectable
					? "cursor-pointer hover:bg-muted/40"
					: "cursor-not-allowed opacity-60"
			)}
		>
			<input
				checked={selected}
				className="sr-only"
				disabled={!selectable}
				name="node"
				onChange={() => onSelect(node.id)}
				type="radio"
				value={node.id}
			/>
			<EntityIconChip icon={HardDrive} size="sm" />
			<div className="min-w-0 flex-1">
				<div className="font-medium text-sm">{node.name}</div>
				<div className="truncate font-mono text-muted-foreground text-xs">
					{node.fqdn}
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1">
				<StatusIndicator
					live={node.status === "online"}
					status={nodeStatus(node.status)}
				/>
				<span className="text-muted-foreground text-xs tabular-nums">
					{capacity ?? "—"}
				</span>
			</div>
		</label>
	);
}
