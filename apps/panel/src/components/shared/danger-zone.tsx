import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

// The shared "Danger zone" surface: a destructive-tinted card holding a stack
// of labelled rows, each with its own action (usually opening a confirm
// dialog). Used by account, org, node, and server settings so the pattern reads
// identically everywhere.

export function DangerZoneCard({
	description,
	children,
}: {
	description: string;
	children: ReactNode;
}) {
	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-destructive">Danger zone</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}

/** Wraps a set of DangerRows with the hairline dividers between them. */
export function DangerRows({ children }: { children: ReactNode }) {
	return <div className="divide-y">{children}</div>;
}

export function DangerRow({
	action,
	description,
	title,
}: {
	action: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<div className="font-medium text-sm">{title}</div>
				<div className="text-muted-foreground text-xs">{description}</div>
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	);
}
