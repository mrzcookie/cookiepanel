import { type StatusMeta, statusLabelClass } from "@/lib/status";
import { cn } from "@/lib/utils";

// The instrument-panel status chip: `[ LABEL ]` in mono + uppercase with a
// semantic tone. The bracket notation reads as a console readout, not a generic
// dot-pill — the one way state is shown across nodes, servers, drives, templates.
// `live` adds an alpha-only pulse (no glow). Color never carries meaning alone:
// the label always spells out the state.
export function StatusIndicator({
	className,
	live,
	status,
}: {
	className?: string;
	live?: boolean;
	status: StatusMeta;
}) {
	return (
		<span
			className={cn(
				"whitespace-nowrap font-mono text-xs uppercase tabular-nums tracking-wide",
				statusLabelClass(status.tone),
				live &&
					"animate-[live-pulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none",
				className
			)}
		>
			[ {status.label} ]
		</span>
	);
}
