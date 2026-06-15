import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import {
	markAllRead,
	markRead,
	type Notification,
	type NotificationTone,
	useNotifications,
	useUnreadCount,
} from "@/lib/stores/notifications-store";
import { cn } from "@/lib/utils";

// The icon-chip accent per tone — color is confined to state, matching the
// rest of the panel.
const TONE_CHIP: Record<NotificationTone, string> = {
	info: "bg-brand-wash text-brand",
	ok: "bg-ok-wash text-ok",
	warn: "bg-warn-wash text-warn",
	danger: "bg-danger-wash text-destructive",
};

function NotificationRow({ item }: { item: Notification }) {
	return (
		<li>
			<button
				className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
				onClick={() => markRead(item.id)}
				type="button"
			>
				<span
					className={cn(
						"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
						TONE_CHIP[item.tone]
					)}
				>
					<item.icon className="size-4" />
				</span>
				<div className="min-w-0 flex-1 space-y-0.5">
					<p className="flex items-center gap-2 font-medium text-sm">
						<span className="truncate">{item.title}</span>
						{item.read ? null : (
							<span
								aria-hidden
								className="size-1.5 shrink-0 rounded-full bg-brand"
							/>
						)}
					</p>
					<p className="text-muted-foreground text-sm">{item.description}</p>
					<p className="font-mono text-muted-foreground/70 text-xs">
						{item.time}
					</p>
				</div>
			</button>
		</li>
	);
}

export function NotificationsPanel() {
	const notifications = useNotifications();
	const unread = useUnreadCount();

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button className="relative size-8" size="icon" variant="ghost">
					<Bell />
					{unread > 0 ? (
						<span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand font-mono text-[0.625rem] text-primary-foreground tabular-nums">
							{unread > 9 ? "9+" : unread}
						</span>
					) : null}
					<span className="sr-only">
						Notifications{unread > 0 ? `, ${unread} unread` : ""}
					</span>
				</Button>
			</SheetTrigger>
			<SheetContent className="w-full gap-0 p-0 sm:max-w-sm">
				<SheetHeader className="flex-row items-center justify-between gap-2 border-b">
					<div className="space-y-0.5">
						<SheetTitle>Notifications</SheetTitle>
						<SheetDescription>
							{unread > 0 ? `${unread} unread` : "You're all caught up."}
						</SheetDescription>
					</div>
					{unread > 0 ? (
						<Button
							className="mr-8"
							onClick={() => markAllRead()}
							size="sm"
							variant="outline"
						>
							Mark all read
						</Button>
					) : null}
				</SheetHeader>
				{notifications.length === 0 ? (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
						<Bell className="size-6 text-muted-foreground" />
						<p className="font-medium text-sm">No notifications</p>
						<p className="text-muted-foreground text-sm">
							Alerts about your fleet will show up here.
						</p>
					</div>
				) : (
					<ol className="flex-1 divide-y overflow-y-auto">
						{notifications.map((item) => (
							<NotificationRow item={item} key={item.id} />
						))}
					</ol>
				)}
			</SheetContent>
		</Sheet>
	);
}
