import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ServerRow } from "@/lib/domain/servers";

// The compact recent-activity card under Details on the console tab. Per-server
// activity isn't wired to the org activity log yet, so it shows an honest empty
// state rather than inventing events.
export function ServerActivityCard({
	className,
	server,
}: {
	className?: string;
	server: ServerRow;
}) {
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
			<CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
				<History className="size-5 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">No activity yet.</p>
			</CardContent>
		</Card>
	);
}
