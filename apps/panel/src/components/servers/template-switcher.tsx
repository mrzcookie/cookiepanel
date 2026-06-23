import { useState } from "react";
import { toast } from "sonner";
import { TemplatePicker } from "@/components/servers/template-picker";
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
import type { ServerRow } from "@/lib/domain/servers";
import { isDeployable } from "@/lib/domain/templates";
import { useTemplates } from "@/lib/templates-queries";

// Switch the template a server runs on. Different templates have different
// variable schemas, so switching resets the runtime + startup variables to the
// new template's defaults (the data volume is kept) — applied on a reinstall.
// Hidden when there's no other deployable template to switch to.
export function ChangeTemplateButton({ server }: { server: ServerRow }) {
	const templates = useTemplates();
	const alternatives = templates.filter((t) => t.id !== server.templateId);
	const canSwitch = alternatives.some(isDeployable);

	const [open, setOpen] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	if (!canSwitch) {
		return null;
	}

	const selected = selectedId
		? templates.find((t) => t.id === selectedId)
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
		// Re-snapshotting onto a different template + recreating the container lands
		// with the install pipeline (a later slice).
		toast.message("Template switching lands with the install pipeline.");
		close(false);
	}

	return (
		<>
			<Button onClick={() => setOpen(true)} size="sm" variant="outline">
				Change template
			</Button>
			<Dialog onOpenChange={close} open={open}>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>Switch template</DialogTitle>
						<DialogDescription>
							Pick a different template for “{server.name}”. This changes the
							runtime and resets startup variables to the new template's
							defaults. Your data volume is kept — reinstall to apply.
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-[60vh] overflow-y-auto pr-1">
						<TemplatePicker
							onSelect={setSelectedId}
							selectedId={selectedId}
							templates={alternatives}
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!ready} onClick={confirm}>
							Switch template
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
