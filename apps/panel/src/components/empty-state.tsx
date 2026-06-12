import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon?: LucideIcon;
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
			{Icon ? (
				<Icon className="size-7 text-muted-foreground" strokeWidth={1.75} />
			) : null}
			<div className="space-y-1">
				<h2 className="font-medium text-sm">{title}</h2>
				{description ? (
					<p className="mx-auto max-w-sm text-muted-foreground text-sm">
						{description}
					</p>
				) : null}
			</div>
			{action ? <div className="pt-1">{action}</div> : null}
		</div>
	);
}
