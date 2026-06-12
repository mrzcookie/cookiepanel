import {
	type StatusMeta,
	statusDotClass,
	statusLabelClass,
} from "@/lib/status";
import { cn } from "@/lib/utils";

// A status dot + label. The single component for status in both grid cards and
// table rows, so a state reads identically across views.
export function StatusIndicator({
	className,
	status,
}: {
	className?: string;
	status: StatusMeta;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-xs",
				statusLabelClass(status.tone),
				className
			)}
		>
			<span
				aria-hidden
				className={cn(
					"size-2 shrink-0 rounded-full",
					statusDotClass(status.tone)
				)}
			/>
			{status.label}
		</span>
	);
}
