import {
	Archive,
	ArrowDown,
	ArrowUp,
	Clock,
	Power,
	TerminalSquare,
	Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	DAYS,
	frequencyLabel,
	newStep,
	type PowerAction,
	type ScheduleFrequency,
	type ScheduleStep,
	type ScheduleStepKind,
	STEP_META,
	stepSummary,
	stepValid,
} from "@/lib/schedules";
import { createSchedule } from "@/lib/schedules-store";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<ScheduleStepKind, typeof Clock> = {
	command: TerminalSquare,
	wait: Clock,
	power: Power,
	backup: Archive,
};

const STEP_ORDER: ScheduleStepKind[] = ["command", "wait", "power", "backup"];

const PAGES = ["Schedule", "Steps", "Review"] as const;

export function ScheduleWizard({
	onOpenChange,
	open,
	serverId,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	serverId: string;
}) {
	const [page, setPage] = useState(0);
	const [name, setName] = useState("");
	const [frequency, setFrequency] = useState<ScheduleFrequency>("daily");
	const [time, setTime] = useState("04:00");
	const [dayOfWeek, setDayOfWeek] = useState(0);
	const [steps, setSteps] = useState<ScheduleStep[]>([]);

	useEffect(() => {
		if (open) {
			setPage(0);
			setName("");
			setFrequency("daily");
			setTime("04:00");
			setDayOfWeek(0);
			setSteps([]);
		}
	}, [open]);

	function addStep(kind: ScheduleStepKind) {
		setSteps((current) => [...current, newStep(kind, crypto.randomUUID())]);
	}
	function changeStep(updated: ScheduleStep) {
		setSteps((current) =>
			current.map((step) => (step.id === updated.id ? updated : step))
		);
	}
	function removeStep(id: string) {
		setSteps((current) => current.filter((step) => step.id !== id));
	}
	function moveStep(index: number, direction: -1 | 1) {
		setSteps((current) => {
			const target = index + direction;
			if (target < 0 || target >= current.length) {
				return current;
			}
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	}

	const scheduleValid = name.trim() !== "";
	const stepsValid = steps.length > 0 && steps.every(stepValid);
	const canAdvance =
		page === 0 ? scheduleValid : page === 1 ? stepsValid : true;

	function create() {
		createSchedule(serverId, { name, frequency, time, dayOfWeek, steps });
		toast.success(`Created schedule “${name.trim()}”.`);
		onOpenChange(false);
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>New schedule</DialogTitle>
					<DialogDescription>
						Step {page + 1} of {PAGES.length} · {PAGES[page]}
					</DialogDescription>
				</DialogHeader>

				<Stepper page={page} />

				<div className="py-2">
					{page === 0 ? (
						<SchedulePage
							dayOfWeek={dayOfWeek}
							frequency={frequency}
							name={name}
							onDayOfWeek={setDayOfWeek}
							onFrequency={setFrequency}
							onName={setName}
							onTime={setTime}
							time={time}
						/>
					) : null}
					{page === 1 ? (
						<StepsPage
							onAdd={addStep}
							onChange={changeStep}
							onMove={moveStep}
							onRemove={removeStep}
							steps={steps}
						/>
					) : null}
					{page === 2 ? (
						<ReviewPage
							frequency={frequency}
							dayOfWeek={dayOfWeek}
							name={name}
							steps={steps}
							time={time}
						/>
					) : null}
				</div>

				<DialogFooter className="sm:justify-between">
					<Button
						className={page === 0 ? "invisible" : undefined}
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						type="button"
						variant="outline"
					>
						Back
					</Button>
					{page < PAGES.length - 1 ? (
						<Button
							disabled={!canAdvance}
							onClick={() => setPage((p) => p + 1)}
							type="button"
						>
							Next
						</Button>
					) : (
						<Button onClick={create} type="button">
							Create schedule
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Stepper({ page }: { page: number }) {
	return (
		<ol className="flex items-center gap-2">
			{PAGES.map((label, index) => (
				<li className="flex flex-1 items-center gap-2" key={label}>
					<span
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-full font-medium text-xs",
							index <= page
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground"
						)}
					>
						{index + 1}
					</span>
					<span
						className={cn(
							"text-sm",
							index === page ? "font-medium" : "text-muted-foreground"
						)}
					>
						{label}
					</span>
					{index < PAGES.length - 1 ? (
						<span className="h-px flex-1 bg-border" />
					) : null}
				</li>
			))}
		</ol>
	);
}

function SchedulePage({
	dayOfWeek,
	frequency,
	name,
	onDayOfWeek,
	onFrequency,
	onName,
	onTime,
	time,
}: {
	dayOfWeek: number;
	frequency: ScheduleFrequency;
	name: string;
	onDayOfWeek: (day: number) => void;
	onFrequency: (frequency: ScheduleFrequency) => void;
	onName: (name: string) => void;
	onTime: (time: string) => void;
	time: string;
}) {
	return (
		<div className="space-y-4">
			<div className="grid gap-2">
				<Label htmlFor="schedule-name">Name</Label>
				<Input
					autoFocus
					id="schedule-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="Nightly restart"
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-4 sm:flex-row">
				<div className="grid gap-2">
					<Label htmlFor="schedule-frequency">How often</Label>
					<Select
						onValueChange={(value) => onFrequency(value as ScheduleFrequency)}
						value={frequency}
					>
						<SelectTrigger className="w-40" id="schedule-frequency">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="hourly">Every hour</SelectItem>
							<SelectItem value="daily">Every day</SelectItem>
							<SelectItem value="weekly">Every week</SelectItem>
						</SelectContent>
					</Select>
				</div>
				{frequency === "weekly" ? (
					<div className="grid gap-2">
						<Label htmlFor="schedule-day">On</Label>
						<Select
							onValueChange={(value) => onDayOfWeek(Number(value))}
							value={String(dayOfWeek)}
						>
							<SelectTrigger className="w-40" id="schedule-day">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DAYS.map((day, index) => (
									<SelectItem key={day} value={String(index)}>
										{day}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				) : null}
				{frequency !== "hourly" ? (
					<div className="grid gap-2">
						<Label htmlFor="schedule-time">At</Label>
						<Input
							className="w-32 tabular-nums"
							id="schedule-time"
							onChange={(event) => onTime(event.target.value)}
							type="time"
							value={time}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

function StepsPage({
	onAdd,
	onChange,
	onMove,
	onRemove,
	steps,
}: {
	onAdd: (kind: ScheduleStepKind) => void;
	onChange: (step: ScheduleStep) => void;
	onMove: (index: number, direction: -1 | 1) => void;
	onRemove: (id: string) => void;
	steps: ScheduleStep[];
}) {
	return (
		<div className="space-y-4">
			{steps.length === 0 ? (
				<p className="rounded-lg border border-dashed py-6 text-center text-muted-foreground text-sm">
					Add steps below. They run top to bottom each time the schedule fires.
				</p>
			) : (
				<ol className="space-y-2">
					{steps.map((step, index) => (
						<StepEditor
							index={index}
							key={step.id}
							last={index === steps.length - 1}
							onChange={onChange}
							onMove={onMove}
							onRemove={onRemove}
							step={step}
						/>
					))}
				</ol>
			)}
			<div className="space-y-2">
				<div className="text-muted-foreground text-xs">Add a step</div>
				<div className="grid gap-2 sm:grid-cols-2">
					{STEP_ORDER.map((kind) => {
						const Icon = STEP_ICON[kind];
						return (
							<button
								className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent"
								key={kind}
								onClick={() => onAdd(kind)}
								type="button"
							>
								<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0">
									<span className="block font-medium text-sm">
										{STEP_META[kind].label}
									</span>
									<span className="block text-muted-foreground text-xs">
										{STEP_META[kind].description}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function StepEditor({
	index,
	last,
	onChange,
	onMove,
	onRemove,
	step,
}: {
	index: number;
	last: boolean;
	onChange: (step: ScheduleStep) => void;
	onMove: (index: number, direction: -1 | 1) => void;
	onRemove: (id: string) => void;
	step: ScheduleStep;
}) {
	const Icon = STEP_ICON[step.kind];

	return (
		<li className="flex items-center gap-3 rounded-lg border p-3">
			<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
				{index + 1}
			</span>
			<Icon className="size-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<StepFields onChange={onChange} step={step} />
			</div>
			<div className="flex shrink-0 items-center">
				<Button
					className="size-7 text-muted-foreground"
					disabled={index === 0}
					onClick={() => onMove(index, -1)}
					size="icon"
					variant="ghost"
				>
					<ArrowUp />
					<span className="sr-only">Move up</span>
				</Button>
				<Button
					className="size-7 text-muted-foreground"
					disabled={last}
					onClick={() => onMove(index, 1)}
					size="icon"
					variant="ghost"
				>
					<ArrowDown />
					<span className="sr-only">Move down</span>
				</Button>
				<Button
					className="size-7 text-muted-foreground"
					onClick={() => onRemove(step.id)}
					size="icon"
					variant="ghost"
				>
					<Trash2 />
					<span className="sr-only">Remove step</span>
				</Button>
			</div>
		</li>
	);
}

function StepFields({
	onChange,
	step,
}: {
	onChange: (step: ScheduleStep) => void;
	step: ScheduleStep;
}): ReactNode {
	if (step.kind === "command") {
		return (
			<Input
				aria-label="Console command"
				className="h-8 font-mono text-sm"
				onChange={(event) => onChange({ ...step, command: event.target.value })}
				placeholder="say Restarting in 60 seconds"
				value={step.command}
			/>
		);
	}
	if (step.kind === "wait") {
		return (
			<div className="flex items-center gap-2">
				<Input
					aria-label="Seconds to wait"
					className="h-8 w-24 tabular-nums"
					inputMode="numeric"
					min={1}
					onChange={(event) =>
						onChange({ ...step, seconds: Number(event.target.value) })
					}
					type="number"
					value={step.seconds}
				/>
				<span className="text-muted-foreground text-sm">seconds</span>
			</div>
		);
	}
	if (step.kind === "power") {
		return (
			<Select
				onValueChange={(value) =>
					onChange({ ...step, action: value as PowerAction })
				}
				value={step.action}
			>
				<SelectTrigger className="h-8 w-40" aria-label="Power action">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="start">Start the server</SelectItem>
					<SelectItem value="stop">Stop the server</SelectItem>
					<SelectItem value="restart">Restart the server</SelectItem>
				</SelectContent>
			</Select>
		);
	}
	return <span className="text-sm">Back up the server's data volume</span>;
}

function ReviewPage({
	dayOfWeek,
	frequency,
	name,
	steps,
	time,
}: {
	dayOfWeek: number;
	frequency: ScheduleFrequency;
	name: string;
	steps: ScheduleStep[];
	time: string;
}) {
	return (
		<div className="space-y-4">
			<div className="rounded-lg border p-3">
				<div className="font-medium text-sm">{name.trim() || "Untitled"}</div>
				<div className="text-muted-foreground text-sm">
					{frequencyLabel({ frequency, time, dayOfWeek })}
				</div>
			</div>
			<div>
				<div className="mb-2 text-muted-foreground text-xs">
					Runs these steps in order
				</div>
				<ol className="space-y-2">
					{steps.map((step, index) => (
						<li className="flex items-center gap-3 text-sm" key={step.id}>
							<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
								{index + 1}
							</span>
							{stepSummary(step)}
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}
