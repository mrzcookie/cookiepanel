import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
	title,
	description,
	actions,
	border = true,
}: {
	title: string;
	description?: string;
	actions?: ReactNode;
	/** Bottom hairline + padding. Turn off when tabs render the divider instead. */
	border?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-start justify-between gap-4",
				border && "border-b pb-4"
			)}
		>
			<div className="min-w-0 space-y-1">
				<h1 className="font-bold text-2xl tracking-tight">{title}</h1>
				{description ? (
					<p className="text-muted-foreground text-sm">{description}</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}
