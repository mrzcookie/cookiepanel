import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The grid card shell every fleet entity fills. Three optional bands —
// header (icon chip + title + status/action slot), body (children), footer —
// on the app's standard `ring-1` card. Bodies differ per entity (usage meters,
// stat rows, a summary), but the chrome stays pixel-identical across pages.
export function EntityCard({
	action,
	children,
	footer,
	icon,
	subtitle,
	subtitleMono,
	title,
	titleSuffix,
}: {
	/** Top-right slot: a status indicator or an ownership badge. */
	action?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	icon: LucideIcon;
	subtitle?: ReactNode;
	subtitleMono?: boolean;
	title: string;
	/** Inline badge after the title (e.g. an "Update" hint). */
	titleSuffix?: ReactNode;
}) {
	return (
		<Card className="min-h-44 gap-3">
			<div className="flex items-start gap-3 px-4">
				<EntityIconChip icon={icon} />
				<div className="grid min-w-0 flex-1 gap-0.5">
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate font-heading font-medium text-base leading-snug">
							{title}
						</span>
						{titleSuffix}
					</div>
					{subtitle ? (
						<div
							className={cn(
								"min-w-0 truncate text-muted-foreground text-xs",
								subtitleMono && "font-mono"
							)}
						>
							{subtitle}
						</div>
					) : null}
				</div>
				{action ? (
					<div className="flex shrink-0 items-center">{action}</div>
				) : null}
			</div>
			<CardContent className="flex-1">{children}</CardContent>
			{footer ? (
				<CardFooter className="justify-between gap-3 border-t bg-muted/50 px-4 py-3 text-muted-foreground text-xs">
					{footer}
				</CardFooter>
			) : null}
		</Card>
	);
}

// A neutral rounded icon tile. `md` for cards, `sm` for the table's first cell —
// so the entity glyph matches in both views.
export function EntityIconChip({
	icon: Icon,
	size = "md",
}: {
	icon: LucideIcon;
	size?: "md" | "sm";
}) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
				size === "md" ? "size-9" : "size-8"
			)}
		>
			<Icon
				className={size === "md" ? "size-4.5" : "size-4"}
				strokeWidth={1.75}
			/>
		</span>
	);
}

// The identity cluster (chip + name + optional subtitle + inline badge) used as
// the first cell of every list table — the table twin of the card header.
export function EntityIdentity({
	badge,
	icon,
	subtitle,
	subtitleMono,
	title,
}: {
	badge?: ReactNode;
	icon: LucideIcon;
	subtitle?: ReactNode;
	subtitleMono?: boolean;
	title: string;
}) {
	return (
		<div className="flex items-center gap-3">
			<EntityIconChip icon={icon} size="sm" />
			<div className="min-w-0">
				<div className="flex items-center gap-2">
					<span className="truncate font-medium">{title}</span>
					{badge}
				</div>
				{subtitle ? (
					<div
						className={cn(
							"truncate text-muted-foreground text-xs",
							subtitleMono && "font-mono"
						)}
					>
						{subtitle}
					</div>
				) : null}
			</div>
		</div>
	);
}

// A label/value row for a card body (the card twin of detail-list's DetailRow).
// Plain spans, not dt/dd, so a body can freely mix stats and usage meters.
export function CardStat({
	label,
	mono,
	value,
}: {
	label: string;
	mono?: boolean;
	value: ReactNode;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="shrink-0 text-muted-foreground text-xs">{label}</span>
			<span
				className={cn(
					"min-w-0 truncate text-right text-sm",
					mono && "font-mono text-xs"
				)}
			>
				{value}
			</span>
		</div>
	);
}

// A thin neutral usage bar. Fill stays neutral until a metric is under stress,
// the one moment color is warranted ("color carries state, never decoration").
export function UsageBar({
	stressed,
	value,
}: {
	stressed?: boolean;
	value: number;
}) {
	return (
		<div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
			<div
				className={cn(
					"h-full rounded-full",
					stressed ? "bg-destructive" : "bg-foreground/70"
				)}
				style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
			/>
		</div>
	);
}

// A labeled meter: "CPU … 41%" over a bar. `value` null (idle / not reporting)
// renders an empty track and a muted detail — never a misleading zero.
export function UsageMeter({
	detail,
	label,
	stressed,
	value,
}: {
	detail: ReactNode;
	label: string;
	stressed?: boolean;
	value: number | null;
}) {
	return (
		<div className="grid gap-1.5">
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="text-muted-foreground">{label}</span>
				<span
					className={cn(
						"tabular-nums",
						value === null && "text-muted-foreground"
					)}
				>
					{detail}
				</span>
			</div>
			{value === null ? (
				<div className="h-1 rounded-full bg-muted" />
			) : (
				<UsageBar stressed={stressed} value={value} />
			)}
		</div>
	);
}
