import { Activity, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

export type ActivityItem = {
	id: string;
	icon: LucideIcon;
	/** Optional actor name, rendered bold ahead of the description. */
	actor?: string;
	description: string;
	time: string;
};

export function ActivityList({ items }: { items: ActivityItem[] }) {
	if (items.length === 0) {
		return (
			<EmptyState
				description="Recent actions will show up here."
				icon={Activity}
				title="No activity yet"
			/>
		);
	}
	return (
		<ol className="space-y-4">
			{items.map((item) => (
				<li className="flex items-start gap-3" key={item.id}>
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
						<item.icon className="size-4" />
					</span>
					<div className="min-w-0 flex-1 space-y-0.5">
						<p className="text-sm">
							{item.actor ? (
								<span className="font-medium">{item.actor} </span>
							) : null}
							{item.description}
						</p>
						<p className="text-muted-foreground text-xs">{item.time}</p>
					</div>
				</li>
			))}
		</ol>
	);
}
