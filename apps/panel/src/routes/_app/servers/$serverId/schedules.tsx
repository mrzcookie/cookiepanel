import { useQueryClient } from "@tanstack/react-query";
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
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingRows } from "@/components/shared/loading-rows";
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
import {
	frequencyLabel,
	type Schedule,
	stepSummary,
} from "@/lib/domain/schedules";
import { pluralize } from "@/lib/format";
import {
	deleteSchedule,
	invalidateSchedules,
	runSchedule,
	upsertSchedule,
	useServerSchedules,
} from "@/lib/schedules-queries";
import { useServer } from "@/lib/server-queries";

export const Route = createFileRoute("/_app/servers/$serverId/schedules")({
	component: ServerSchedulesTab,
});

function ServerSchedulesTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const { data, isLoading } = useServerSchedules(serverId);
	const [wizardOpen, setWizardOpen] = useState(false);

	if (!server) {
		return null;
	}

	const schedules = data?.ok ? data.data : [];
	const unreachable = Boolean(data && !data.ok);

	return (
		<Card>
			<CardHeader className="flex flex-row items-start justify-between gap-4">
				<div className="space-y-1.5">
					<CardTitle>Schedules</CardTitle>
					<CardDescription>
						Automations that run on the node; they keep firing even when the
						panel is offline.
					</CardDescription>
				</div>
				<Button
					disabled={unreachable}
					onClick={() => setWizardOpen(true)}
					size="sm"
				>
					<Plus />
					New schedule
				</Button>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<LoadingRows />
				) : unreachable ? (
					<div className="rounded-lg border border-warn/40 bg-warn-wash py-12 text-center text-sm text-warn-foreground">
						Can't reach this server's node, so its schedules aren't available
						right now.
					</div>
				) : schedules.length === 0 ? (
					<EmptyState
						action={
							<Button onClick={() => setWizardOpen(true)} size="sm">
								<Plus />
								New schedule
							</Button>
						}
						description="Build a multi-step automation: restart, send a command, and more."
						icon={CalendarClock}
						title="No schedules yet"
					/>
				) : (
					<ul className="divide-y">
						{schedules.map((schedule) => (
							<ScheduleRow
								key={schedule.id}
								schedule={schedule}
								serverId={serverId}
							/>
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

function ScheduleRow({
	schedule,
	serverId,
}: {
	schedule: Schedule;
	serverId: string;
}) {
	const queryClient = useQueryClient();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const stepsLine = schedule.steps.map(stepSummary).join(" → ");

	async function toggle() {
		setBusy(true);
		try {
			await upsertSchedule({
				serverId,
				id: schedule.id,
				name: schedule.name,
				frequency: schedule.frequency,
				time: schedule.time,
				dayOfWeek: schedule.dayOfWeek,
				enabled: !schedule.enabled,
				steps: schedule.steps,
			});
			await invalidateSchedules(queryClient, serverId);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the schedule."
			);
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		try {
			await deleteSchedule(serverId, schedule.id);
			await invalidateSchedules(queryClient, serverId);
			toast.success(`Deleted “${schedule.name}”.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't delete the schedule."
			);
		}
	}

	async function run() {
		try {
			await runSchedule(serverId, schedule.id);
			toast.success(`Running “${schedule.name}”…`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't run the schedule."
			);
		}
	}

	return (
		<li className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="min-w-0 space-y-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{schedule.name}</span>
					{schedule.enabled ? null : <Badge variant="secondary">Paused</Badge>}
					{schedule.lastStatus === "error" ? (
						<Badge variant="destructive">Last run failed</Badge>
					) : null}
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
					disabled={busy}
					onCheckedChange={toggle}
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
						<DropdownMenuItem onClick={run}>
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
								remove();
								setDeleteOpen(false);
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
