import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
	/** Stable key, used as the React key. */
	id: string;
	/** Mono uppercase label shown in the rail. */
	label: string;
};

// The instrument-panel step rail. Sharp square markers (never circles/pills), a
// hairline connector that brightens once a step is cleared, and a "// step N of
// M" eyebrow for orientation. Desktop shows the full horizontal rail; narrow
// screens collapse to the eyebrow + the current label + a segmented hairline
// progress line. The rail is aria-hidden — position is carried by the eyebrow
// text and by focus moving to the step heading (see WizardFrame), so the marker
// glyph (number vs. check) and the eyebrow always spell out where you are.
export function WizardStepper({
	className,
	current,
	steps,
}: {
	className?: string;
	/** Zero-based index of the active step. */
	current: number;
	steps: WizardStep[];
}) {
	const total = steps.length;
	const active = steps[current];

	return (
		<div className={cn("space-y-3", className)}>
			<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
				{`// step ${current + 1} of ${total}`}
			</p>

			<ol aria-hidden className="hidden items-center gap-2 sm:flex">
				{steps.map((step, index) => {
					const state =
						index < current
							? "complete"
							: index === current
								? "active"
								: "upcoming";
					return (
						<li
							className="flex min-w-0 flex-1 items-center gap-2 last:flex-none"
							key={step.id}
						>
							<span className="flex min-w-0 items-center gap-2">
								<span
									className={cn(
										"flex size-6 shrink-0 items-center justify-center rounded-sm border font-mono text-[0.7rem] tabular-nums transition-colors",
										state === "complete" &&
											"border-primary bg-primary text-primary-foreground",
										state === "active" && "border-primary text-primary",
										state === "upcoming" &&
											"border-border text-muted-foreground"
									)}
								>
									{state === "complete" ? (
										<Check className="size-3.5" />
									) : (
										index + 1
									)}
								</span>
								<span
									className={cn(
										"truncate font-mono text-xs uppercase tracking-wider transition-colors",
										state === "active"
											? "text-foreground"
											: state === "complete"
												? "text-muted-foreground"
												: "text-muted-foreground/70"
									)}
								>
									{step.label}
								</span>
							</span>
							{index < total - 1 ? (
								<span
									className={cn(
										"h-px min-w-4 flex-1 transition-colors",
										index < current ? "bg-primary" : "bg-border"
									)}
								/>
							) : null}
						</li>
					);
				})}
			</ol>

			<div className="space-y-2 sm:hidden">
				<p className="font-mono text-foreground text-xs uppercase tracking-wider">
					{active?.label}
				</p>
				<div aria-hidden className="flex gap-1">
					{steps.map((step, index) => (
						<span
							className={cn(
								"h-px flex-1 transition-colors",
								index <= current ? "bg-primary" : "bg-border"
							)}
							key={step.id}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
