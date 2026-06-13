import { type ReactNode, useEffect, useRef } from "react";
import {
	type WizardStep,
	WizardStepper,
} from "@/components/wizard/wizard-stepper";

// The shared wizard chrome: the step rail, a bordered body that frames the
// active step, a footer for the Back / Next (or terminal) actions, and a polite
// live region for async status. The body is a bordered <section>, NOT a Card, so
// a step may freely contain Cards without nesting them. The concrete wizard
// renders the back-link + PageHeader above this and supplies the step body +
// footer; this owns presentation and focus.
export function WizardFrame({
	children,
	current,
	footer,
	status,
	stepDescription,
	stepHeading,
	steps,
}: {
	children: ReactNode;
	current: number;
	footer: ReactNode;
	/** Polite live-region text for async transitions (announced, not focused). */
	status?: string;
	stepDescription?: string;
	/** Heading for THIS step — focus lands here on every step change. */
	stepHeading: string;
	steps: WizardStep[];
}) {
	const headingRef = useRef<HTMLHeadingElement>(null);
	const mounted = useRef(false);

	// Move focus to the step heading whenever the step CHANGES, so keyboard and
	// screen-reader users are repositioned at the top of the new step instead of
	// stranded on a control that just unmounted. We skip the first run so landing
	// on the page doesn't yank focus past the header into the body. tabIndex={-1}
	// keeps the heading programmatically focusable without entering the tab order.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refocus the heading on step change
	useEffect(() => {
		if (!mounted.current) {
			mounted.current = true;
			return;
		}
		headingRef.current?.focus();
	}, [current]);

	return (
		<>
			<WizardStepper current={current} steps={steps} />

			{/* Transparent body so a step's own Cards / picker tiles (which use
			    bg-card) stand out against it instead of blending in. */}
			<section
				aria-labelledby="wizard-step-heading"
				className="overflow-hidden rounded-xl ring-1 ring-foreground/10"
			>
				<div className="space-y-1 px-6 py-5">
					<h2
						className="font-heading font-medium text-base leading-snug outline-none"
						id="wizard-step-heading"
						ref={headingRef}
						tabIndex={-1}
					>
						{stepHeading}
					</h2>
					{stepDescription ? (
						<p className="text-muted-foreground text-sm">{stepDescription}</p>
					) : null}
				</div>

				<div className="border-t px-6 py-6">{children}</div>

				<footer className="flex flex-wrap items-center gap-2 border-t bg-muted/50 px-6 py-4">
					{footer}
				</footer>
			</section>

			<p aria-live="polite" className="sr-only" role="status">
				{status}
			</p>
		</>
	);
}
