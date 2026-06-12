import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function DetailList({ children }: { children: ReactNode }) {
	return <dl className="divide-y">{children}</dl>;
}

export function DetailRow({
	copyable,
	label,
	value,
}: {
	copyable?: boolean;
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
			<dt className="shrink-0 text-muted-foreground text-sm">{label}</dt>
			<dd className="flex min-w-0 items-center gap-1">
				<span className="truncate font-mono text-sm">{value}</span>
				{copyable ? <CopyButton label={label} value={value} /> : null}
			</dd>
		</div>
	);
}

function CopyButton({ label, value }: { label: string; value: string }) {
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
