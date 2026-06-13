import { createFileRoute } from "@tanstack/react-router";
import {
	CalendarClock,
	MoreHorizontal,
	Play,
	Plus,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ScheduleWizard } from "@/components/schedules/schedule-wizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { pluralize } from "@/lib/format";
import { frequencyLabel, type Schedule, stepSummary } from "@/lib/schedules";
import {
	deleteSchedule,
	runSchedule,
	toggleSchedule,
	useServerSchedules,
} from "@/lib/schedules-store";
import { useServer } from "@/lib/servers-store";

export const Route = createFileRoute("/_app/servers/$serverId/schedules")({
	component: ServerSchedulesTab,
});

function ServerSchedulesTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const schedules = useServerSchedules(serverId);
	const [wizardOpen, setWizardOpen] = useState(false);

	if (!server) {
		return null;
	}

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div className="space-y-1.5">
					<CardTitle>Schedules</CardTitle>
					<CardDescription>
						Automations that run on the box — they keep firing even when the
						panel is offline.
					</CardDescription>
				</div>
				<Button onClick={() => setWizardOpen(true)} size="sm">
					<Plus />
					New schedule
				</Button>
			</CardHeader>
			<CardContent>
				{schedules.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
						<CalendarClock className="size-6 text-muted-foreground" />
						<div className="space-y-1">
							<p className="font-medium text-sm">No schedules yet</p>
							<p className="text-muted-foreground text-sm">
								Build a multi-step automation — restart, back up, and more.
							</p>
						</div>
						<Button onClick={() => setWizardOpen(true)} size="sm">
							<Plus />
							New schedule
						</Button>
					</div>
				) : (
					<ul className="divide-y">
						{schedules.map((schedule) => (
							<ScheduleRow key={schedule.id} schedule={schedule} />
						))}
					</ul>
				)}
			</CardContent>

			<ScheduleWizard
				onOpenChange={setWizardOpen}
				open={wizardOpen}
				serverId={serverId}
			/>
		</Card>
	);
}

function ScheduleRow({ schedule }: { schedule: Schedule }) {
	const [deleteOpen, setDeleteOpen] = useState(false);
	const stepsLine = schedule.steps.map(stepSummary).join(" → ");

	return (
		<li className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="min-w-0 space-y-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{schedule.name}</span>
					{schedule.enabled ? null : <Badge variant="secondary">Paused</Badge>}
				</div>
				<div className="text-muted-foreground text-xs">
					{frequencyLabel(schedule)} ·{" "}
					{pluralize(schedule.steps.length, "step")}
				</div>
				<div className="truncate text-muted-foreground text-xs">
					{stepsLine}
				</div>
				<div className="text-muted-foreground text-xs">
					Next: {schedule.enabled ? schedule.nextRun : "paused"}
					{schedule.lastRun ? ` · Last run ${schedule.lastRun}` : ""}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<Switch
					aria-label={`${schedule.name} enabled`}
					checked={schedule.enabled}
					onCheckedChange={() => toggleSchedule(schedule.id)}
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							className="text-muted-foreground"
							size="icon"
							variant="ghost"
						>
							<MoreHorizontal />
							<span className="sr-only">Actions for {schedule.name}</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							onClick={() => {
								runSchedule(schedule.id);
								toast.success(`Running “${schedule.name}”…`);
							}}
						>
							<Play />
							Run now
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => setDeleteOpen(true)}
							variant="destructive"
						>
							<Trash2 />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this schedule?</DialogTitle>
						<DialogDescription>
							Permanently delete “{schedule.name}”. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							onClick={() => {
								deleteSchedule(schedule.id);
								toast.success(`Deleted “${schedule.name}”.`);
							}}
							variant="destructive"
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</li>
	);
}
