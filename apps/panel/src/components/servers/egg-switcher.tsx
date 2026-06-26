import { useState } from "react";
import { toast } from "sonner";
import { EggPicker } from "@/components/servers/egg-picker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { isDeployable } from "@/lib/domain/eggs";
import type { ServerRow } from "@/lib/domain/servers";
import { useEggs } from "@/lib/eggs-queries";

// Switch the egg a server runs on. Different eggs have different
// variable schemas, so switching resets the runtime + startup variables to the
// new egg's defaults (the data volume is kept) — applied on a reinstall.
// Hidden when there's no other deployable egg to switch to.
export function ChangeEggButton({ server }: { server: ServerRow }) {
	const eggs = useEggs();
	const alternatives = eggs.filter((t) => t.id !== server.eggId);
	const canSwitch = alternatives.some(isDeployable);

	const [open, setOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	if (!canSwitch) {
		return null;
	}

	const selected = selectedId
		? eggs.find((t) => t.id === selectedId)
		: undefined;
	const ready = Boolean(selected && isDeployable(selected));

	function close(next: boolean) {
		setOpen(next);
		if (!next) {
			setSelectedId(null);
		}
	}

	function confirm() {
		if (!(selected && isDeployable(selected))) {
			return;
		}
		// Re-snapshotting onto a different egg + recreating the container lands
		// with the install pipeline (a later slice).
		toast.message("Egg switching lands with the install pipeline.");
		close(false);
	}

	return (
		<>
			<Button onClick={() => setOpen(true)} size="sm" variant="outline">
				Change egg
			</Button>
			<Dialog onOpenChange={close} open={open}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Switch egg</DialogTitle>
						<DialogDescription>
							Pick a different egg for “{server.name}”. This changes the runtime
							and resets startup variables to the new egg's defaults. Your data
							volume is kept — reinstall to apply.
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-[60vh] overflow-y-auto pr-1">
						<EggPicker
							onSelect={setSelectedId}
							selectedId={selectedId}
							eggs={alternatives}
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!ready} onClick={confirm}>
							Switch egg
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
