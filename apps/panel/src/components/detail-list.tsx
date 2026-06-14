import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DetailList({ children }: { children: ReactNode }) {
	return <dl className="divide-y">{children}</dl>;
}

export function DetailRow({
	copyable,
	label,
	value,
	wrap,
}: {
	copyable?: boolean;
	label: string;
	value: string;
	/** Show the full value (wrapping) instead of truncating — for credentials and
	 * other data the user must read in full. */
	wrap?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex justify-between gap-4 py-3 first:pt-0 last:pb-0",
				wrap ? "items-start" : "items-center"
			)}
		>
			<dt className="shrink-0 text-muted-foreground text-sm">{label}</dt>
			<dd
				className={cn(
					"flex min-w-0 gap-1",
					wrap ? "items-start" : "items-center"
				)}
			>
				<span
					className={cn("font-mono text-sm", wrap ? "break-all" : "truncate")}
					title={value}
				>
					{value}
				</span>
				{copyable ? <CopyButton label={label} value={value} /> : null}
			</dd>
		</div>
	);
}

export function CopyButton({ label, value }: { label: string; value: string }) {
	return (
		<Button
			className="size-7 shrink-0 text-muted-foreground"
			onClick={async () => {
				try {
					if (!navigator.clipboard) {
						throw new Error("Clipboard unavailable");
					}
					await navigator.clipboard.writeText(value);
					toast.success("Copied to clipboard.");
				} catch {
					toast.error("Couldn't copy to clipboard.");
				}
			}}
			size="icon"
			type="button"
			variant="ghost"
		>
			<Copy />
			<span className="sr-only">Copy {label}</span>
		</Button>
	);
}
