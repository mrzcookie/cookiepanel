import { LayoutGrid, List, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListView } from "@/lib/list-view";
import { cn } from "@/lib/utils";

// A segmented grid/list control: a group of toggle buttons (aria-pressed), so
// native button keyboard semantics hold and we don't promise the radiogroup
// arrow-key contract. The active option borrows the `secondary` button look so
// no new color is needed.
export function ViewToggle({
	onChange,
	value,
}: {
	onChange: (view: ListView) => void;
	value: ListView;
}) {
	return (
		<div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-input bg-transparent p-0.5 dark:bg-input/30">
			<ToggleButton
				active={value === "grid"}
				icon={LayoutGrid}
				label="Grid view"
				onClick={() => onChange("grid")}
			/>
			<ToggleButton
				active={value === "list"}
				icon={List}
				label="List view"
				onClick={() => onChange("list")}
			/>
		</div>
	);
}

function ToggleButton({
	active,
	icon: Icon,
	label,
	onClick,
}: {
	active: boolean;
	icon: LucideIcon;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			aria-pressed={active}
			className={cn(!active && "text-muted-foreground")}
			onClick={onClick}
			size="icon-sm"
			type="button"
			variant={active ? "secondary" : "ghost"}
		>
			<Icon />
			<span className="sr-only">{label}</span>
		</Button>
	);
}
