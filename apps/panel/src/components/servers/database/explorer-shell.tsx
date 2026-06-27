import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { ServerRow } from "@/lib/domain/servers";

// Shared chrome for the database browsers (SQL / Redis / Mongo): the connection
// readout, the bordered data-section shell, row actions, a drill-down
// breadcrumb, and a destructive confirm dialog. Keeps the three add-on tabs
// pixel-identical.

/** The server fields the browsers + connection header read. Passed as primitives
 * (not the whole live-polling `ServerRow`) so a stats poll doesn't re-render the
 * browser unless one of these actually changes. */
export type ServerConnection = Pick<
	ServerRow,
	"eggName" | "nodeAddress" | "port" | "state"
>;

/** The connection readout: `// <add-on> · engine · host:port [ CONNECTED ]`. */
export function ConnectionHeader({
	eggName,
	label,
	nodeAddress,
	port,
	state,
}: { label: string } & ServerConnection) {
	const running = state === "running";
	return (
		<>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{`// ${label.toLowerCase()}`}
				</p>
				<span className="font-mono text-muted-foreground text-xs">
					{eggName} · {nodeAddress}:{port ?? "—"}
				</span>
				<StatusIndicator
					live={running}
					status={
						running
							? { label: "Connected", tone: "online" }
							: { label: "Offline", tone: "muted" }
					}
				/>
			</div>
			{running ? null : (
				<div className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2.5 text-muted-foreground text-sm">
					This server isn't running. You're viewing the last known state; start
					it to make changes take effect.
				</div>
			)}
		</>
	);
}

/** A bordered section with a header bar (title + subtitle + an action). */
export function Section({
	action,
	children,
	subtitle,
	title,
}: {
	action?: ReactNode;
	children: ReactNode;
	subtitle?: ReactNode;
	title: ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-xl ring-1 ring-foreground/10">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
				<div className="min-w-0">
					<div className="font-medium text-sm">{title}</div>
					{subtitle ? (
						<div className="text-muted-foreground text-xs">{subtitle}</div>
					) : null}
				</div>
				{action}
			</div>
			{children}
		</div>
	);
}

export function RowActions({ children }: { children: ReactNode }) {
	return <div className="flex items-center justify-end gap-1">{children}</div>;
}

export function IconAction({
	danger,
	icon: Icon,
	label,
	onClick,
}: {
	danger?: boolean;
	icon: LucideIcon;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			className={
				danger
					? "text-muted-foreground hover:text-destructive"
					: "text-muted-foreground"
			}
			onClick={onClick}
			size="icon-sm"
			variant="ghost"
		>
			<Icon />
			<span className="sr-only">{label}</span>
		</Button>
	);
}

/** Drill-down breadcrumb. The trail reads root → parent; the back arrow goes up
 * exactly one level (the nearest ancestor = the last trail entry). */
export function Breadcrumb({
	current,
	trail,
}: {
	current: string;
	trail: { label: string; onClick: () => void }[];
}) {
	return (
		<span className="flex items-center gap-1.5">
			<button
				className="text-muted-foreground transition-colors hover:text-foreground"
				onClick={trail[trail.length - 1]?.onClick}
				type="button"
			>
				<ArrowLeft className="size-4" />
				<span className="sr-only">Back</span>
			</button>
			{trail.map((crumb) => (
				<span className="flex items-center gap-1.5" key={crumb.label}>
					<button
						className="font-medium text-muted-foreground text-sm transition-colors hover:text-foreground"
						onClick={crumb.onClick}
						type="button"
					>
						{crumb.label}
					</button>
					<ChevronRight className="size-3.5 text-muted-foreground" />
				</span>
			))}
			<span className="font-medium text-sm">{current}</span>
		</span>
	);
}

export function ConfirmDrop({
	confirmLabel,
	description,
	onConfirm,
	onOpenChange,
	open,
	title,
}: {
	confirmLabel: string;
	description: string;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) {
	// Hold the last shown copy so the close animation doesn't briefly render the
	// now-null target's name as "undefined".
	const last = useRef({ confirmLabel, description, title });
	if (open) {
		last.current = { confirmLabel, description, title };
	}
	const shown = open ? { confirmLabel, description, title } : last.current;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{shown.title}</DialogTitle>
					<DialogDescription>{shown.description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
						variant="destructive"
					>
						{shown.confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
