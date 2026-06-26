import { Trash2 } from "lucide-react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// A ghost trash button for removing a table row. `label` names the action for
// screen readers (e.g. "Remove MacBook Pro"). Pass `confirm` to gate the action
// behind a confirmation dialog — use it for anything destructive.
export function RemoveButton({
	label,
	onClick,
	confirm,
}: {
	label: string;
	onClick: () => void;
	confirm?: { title: string; description: string; action?: string };
}) {
	const trigger = (
		<Button
			className="text-muted-foreground"
			onClick={confirm ? undefined : onClick}
			size="icon"
			type="button"
			variant="ghost"
		>
			<Trash2 aria-hidden />
			<span className="sr-only">{label}</span>
		</Button>
	);

	if (!confirm) {
		return trigger;
	}

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{confirm.title}</AlertDialogTitle>
					<AlertDialogDescription>{confirm.description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction onClick={onClick}>
						{confirm.action ?? "Delete"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
