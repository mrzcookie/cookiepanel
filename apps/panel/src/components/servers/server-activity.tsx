import { Link } from "@tanstack/react-router";
import {
	Archive,
	CalendarClock,
	type LucideIcon,
	Pencil,
	Play,
	Plus,
	RotateCw,
	Server,
	Square,
	Upload,
} from "lucide-react";
import type { ActivityItem } from "@/components/shared/activity-list";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ServerRow } from "@/lib/domain/servers";

// A believable, server-scoped audit trail for the UI-first phase. Real activity
// is read from the org's activity log filtered to this server; here it's woven
// from the server's own fields so it reads as this server's history. Shared by
// the full Activity tab and the compact card on the console tab.
export function activityFor(server: ServerRow): ActivityItem[] {
	const entry = (
		id: string,
		icon: LucideIcon,
		actor: string,
		description: string,
		time: string
	): ActivityItem => ({ id, icon, actor, description, time });

	return [
		entry("1", Play, "Jane Cooper", "started the server", "12 minutes ago"),
		entry(
			"2",
			Archive,
			"System",
			"completed a scheduled backup (1.8 GB)",
			"2 hours ago"
		),
		entry("3", Pencil, "Marco Diaz", "edited server.properties", "5 hours ago"),
		entry(
			"4",
			CalendarClock,
			"System",
			"ran schedule “Nightly restart”",
			"Yesterday"
		),
		entry(
			"5",
			Plus,
			"Jane Cooper",
			`allocated a port on ${server.nodeName}`,
			"Yesterday"
		),
		entry("6", RotateCw, "Marco Diaz", "restarted the server", "2 days ago"),
		entry(
			"7",
			Upload,
			"Jane Cooper",
			"uploaded files to the data volume",
			"3 days ago"
		),
		entry(
			"8",
			Square,
			"System",
			"stopped the server for maintenance",
			"4 days ago"
		),
		entry(
			"9",
			Server,
			"Jane Cooper",
			`created the server from ${server.templateName}`,
			server.createdAt
		),
	];
}

// The compact recent-activity card that sits under Details on the console tab —
// the three latest events. `className` lets the console tab stretch it to
// bottom-align with the console; the timeline distributes to fill that height,
// connected by one continuous rail (each opaque chip masks the line behind it).
export function ServerActivityCard({
	className,
	server,
}: {
	className?: string;
	server: ServerRow;
}) {
	const recent = activityFor(server).slice(0, 3);

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Recent activity</CardTitle>
				<CardDescription>The latest actions on this server.</CardDescription>
				<CardAction>
					<Link
						className="font-medium text-muted-foreground text-xs hover:text-foreground"
						params={{ serverId: server.id }}
						to="/servers/$serverId/activity"
					>
						View all
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent className="min-h-0 flex-1">
				<ol className="relative flex h-full flex-col justify-between gap-6">
					<span
						aria-hidden
						className="absolute top-4 bottom-4 left-4 w-px -translate-x-1/2 bg-border"
					/>
					{recent.map((item) => (
						<li className="relative flex gap-4" key={item.id}>
							<span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
								<item.icon className="size-4" />
							</span>
							<div className="min-w-0 flex-1 pt-1.5">
								<p className="text-sm">
									{item.actor ? (
										<span className="font-medium">{item.actor} </span>
									) : null}
									{item.description}
								</p>
								<p className="mt-1 font-mono text-muted-foreground text-xs tracking-wide">
									{item.time}
								</p>
							</div>
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
	);
}
