import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
	title,
	description,
	actions,
	border = true,
	eyebrow,
}: {
	title: ReactNode;
	description?: string;
	actions?: ReactNode;
	/** Bottom hairline + padding. Turn off when tabs render the divider instead. */
	border?: boolean;
	/** A `// section` mono kicker above the title — a categorical frame, not a
	 * restatement of the title. */
	eyebrow?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-start justify-between gap-4",
				border && "border-b pb-4"
			)}
		>
			<div className="min-w-0 space-y-1">
				{eyebrow ? (
					<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{`// ${eyebrow}`}
					</div>
				) : null}
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
