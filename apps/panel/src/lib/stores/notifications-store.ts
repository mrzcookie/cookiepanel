import {
	CircleCheck,
	HardDrive,
	type LucideIcon,
	RefreshCw,
	TriangleAlert,
	UserPlus,
} from "lucide-react";
import { createStore } from "@/lib/store";

// Mutable client-side stub store for notifications — a stand-in for the data
// layer. Powers the topbar slide-out: the unread count badge and the list both
// read this one source of truth, so marking one (or all) read reflects
// everywhere. Mutations happen only in the browser; replaced wholesale when the
// real activity/notification feed lands.

/** The accent applied to a notification's icon chip. */
export type NotificationTone = "info" | "ok" | "warn" | "danger";

export type Notification = {
	id: string;
	icon: LucideIcon;
	tone: NotificationTone;
	title: string;
	description: string;
	time: string;
	read: boolean;
};

const SEED: Notification[] = [
	{
		id: "n_1",
		icon: TriangleAlert,
		tone: "warn",
		title: "Node unreachable",
		description: "orion-03 stopped heartbeating 4 minutes ago.",
		time: "4 min ago",
		read: false,
	},
	{
		id: "n_2",
		icon: RefreshCw,
		tone: "info",
		title: "Server update available",
		description: "A newer template version is published for “survival”.",
		time: "1 hour ago",
		read: false,
	},
	{
		id: "n_3",
		icon: CircleCheck,
		tone: "ok",
		title: "Backup completed",
		description: "“creative” was backed up successfully.",
		time: "3 hours ago",
		read: false,
	},
	{
		id: "n_4",
		icon: UserPlus,
		tone: "info",
		title: "Invitation accepted",
		description: "Marcus joined Acme Gaming.",
		time: "Yesterday",
		read: true,
	},
	{
		id: "n_5",
		icon: HardDrive,
		tone: "ok",
		title: "Node online",
		description: "titan-06 connected and reported its hardware.",
		time: "2 days ago",
		read: true,
	},
];

const store = createStore<Notification[]>(SEED);

export function useNotifications() {
	return store.use();
}

export function useUnreadCount(): number {
	return store.useWith((items) => items.filter((item) => !item.read).length);
}

export function markRead(id: string) {
	store.set(
		store.get().map((item) => (item.id === id ? { ...item, read: true } : item))
	);
}

export function markAllRead() {
	store.set(store.get().map((item) => ({ ...item, read: true })));
}
