import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// A ghost trash button for removing a table row. `label` names the action for
// screen readers (e.g. "Remove MacBook Pro").
export function RemoveButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			className="text-muted-foreground"
			onClick={onClick}
			size="icon"
			type="button"
			variant="ghost"
		>
			<Trash2 aria-hidden />
			<span className="sr-only">{label}</span>
		</Button>
	);
}
