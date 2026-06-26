import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A back-link for the header's kicker slot: a TanStack Link target + a label. */
type BackLinkProps = {
	label: string;
	params?: Record<string, string>;
	to: string;
};

export function PageHeader({
	title,
	description,
	actions,
	back,
	border = true,
	eyebrow,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	/** A back-link in the kicker slot, for detail/wizard headers. Replaces the
	 * eyebrow (the two share the slot; a header has one or the other). */
	back?: BackLinkProps;
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
				{back ? (
					<BackLink {...back} />
				) : eyebrow ? (
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

// The router's typed `to`/`params` don't survive being passed through a generic
// prop, so we widen here at the one boundary; call sites still pass plain strings.
function BackLink({ label, params, to }: BackLinkProps) {
	return (
		<Link
			className="inline-flex w-fit items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
			params={params as never}
			to={to as never}
		>
			<ChevronLeft className="size-4" />
			{label}
		</Link>
	);
}
