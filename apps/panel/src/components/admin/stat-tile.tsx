import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// A compact metric tile for the admin dashboards (overview, billing): a mono
// uppercase label, a big tabular value, and a one-line detail. `tone="warn"`
// tints the value amber for figures that need attention (e.g. a past-due count).
export function StatTile({
	label,
	value,
	detail,
	tone,
}: {
	label: string;
	value: string;
	detail: ReactNode;
	tone?: "warn";
}) {
	return (
		<Card>
			<CardContent className="space-y-1">
				<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{label}
				</div>
				<div
					className={cn(
						"font-mono text-2xl tabular-nums tracking-tight",
						tone === "warn" && "text-warn"
					)}
				>
					{value}
				</div>
				<div className="text-muted-foreground text-sm">{detail}</div>
			</CardContent>
		</Card>
	);
}
