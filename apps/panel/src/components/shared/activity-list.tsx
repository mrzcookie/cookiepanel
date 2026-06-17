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
		<ol className="relative">
			{items.map((item, index) => (
				<li className="relative flex gap-4 pb-6 last:pb-0" key={item.id}>
					{/* The timeline rail: a hairline linking each event to the next.
					    Anchored to the chip centers and masked by the opaque chips, so
					    it reads as one continuous line from first event to last. */}
					{index < items.length - 1 ? (
						<span
							aria-hidden
							className="absolute top-4 -bottom-4 left-4 w-px -translate-x-1/2 bg-border"
						/>
					) : null}
					<span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
						<item.icon className="size-4" />
					</span>
					<div className="min-w-0 flex-1 pt-1.5">
						<p className="text-sm">
							{item.actor ? (
								<span className="font-medium">{item.actor} </span>
							) : null}
							{item.description}
						</p>
						<p
							className="mt-1 font-mono text-muted-foreground text-xs tracking-wide"
							suppressHydrationWarning
						>
							{item.time}
						</p>
					</div>
				</li>
			))}
		</ol>
	);
}
