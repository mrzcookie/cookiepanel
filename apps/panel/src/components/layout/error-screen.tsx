import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The Console error surface: the `// error` eyebrow, a hairline status readout
// (`status … 404`), and a way back. The router's notFoundComponent /
// errorComponent render it full-screen; the entity-not-found states render it
// inline (within the app shell) with a contained height + a tailored action.
export function ErrorScreen({
	action,
	className,
	code,
	description,
	title,
	tone = "danger",
}: {
	/** Overrides the default "Back to overview" button. */
	action?: ReactNode;
	/** Outer min-height; defaults to full screen. */
	className?: string;
	code: string;
	description: string;
	title: string;
	tone?: "muted" | "danger";
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center bg-background px-6",
				className ?? "min-h-svh"
			)}
		>
			<div className="w-full max-w-md space-y-5 text-center">
				<BrandMark
					className="mx-auto size-7 text-muted-foreground"
					strokeWidth={1.75}
				/>
				<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{"// error"}
				</div>
				<h1 className="font-bold text-3xl tracking-tight">{title}</h1>
				<p className="text-muted-foreground text-sm">{description}</p>
				<div className="flex items-center gap-3 font-mono text-xs">
					<span className="text-muted-foreground uppercase tracking-wider">
						status
					</span>
					<span className="h-px flex-1 bg-border" />
					<span
						className={cn(
							"tabular-nums",
							tone === "danger" ? "text-destructive" : "text-muted-foreground"
						)}
					>
						{code}
					</span>
				</div>
				<div className="pt-1">
					{action ?? (
						<Button asChild>
							<Link to="/">Back to overview</Link>
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
