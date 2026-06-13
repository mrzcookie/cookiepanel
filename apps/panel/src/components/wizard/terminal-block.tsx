import { CopyButton } from "@/components/detail-list";
import { cn } from "@/lib/utils";

// The `.terminal` onboarding command box: a deep cool-ink surface with an
// ok-green `$` prompt and a copy button. The prompt is decorative (aria-hidden,
// select-none) so copying grabs only the command; the command wraps inside the
// box rather than overflowing. The reusable home for install commands and logs.
export function TerminalBlock({
	className,
	command,
	label = "install command",
}: {
	className?: string;
	command: string;
	label?: string;
}) {
	return (
		<div
			className={cn(
				"terminal flex items-start gap-3 rounded-lg p-4 font-mono text-sm",
				className
			)}
		>
			<span aria-hidden className="select-none text-ok">
				$
			</span>
			<code className="min-w-0 flex-1 break-all leading-relaxed">
				{command}
			</code>
			<CopyButton label={label} value={command} />
		</div>
	);
}
