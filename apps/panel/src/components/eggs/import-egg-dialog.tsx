import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { eggActions, invalidateEggs } from "@/lib/eggs-queries";
import type { EggScope } from "@/lib/eggs-scope";

type Mode = "paste" | "url";

/**
 * Import a Pterodactyl/Pelican egg (or a Raptor export) by pasting/uploading
 * JSON or from a URL. The server parses the egg into a draft — mapping runtimes,
 * variables, startup, and install — and reports any fields it had to drop; the
 * draft opens in the editor for review before publishing.
 */
export function ImportEggDialog({
	open,
	onOpenChange,
	scope,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	scope: EggScope;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const fileInput = useRef<HTMLInputElement>(null);
	const [mode, setMode] = useState<Mode>("paste");
	const [json, setJson] = useState("");
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);

	function reset() {
		setMode("paste");
		setJson("");
		setUrl("");
	}

	async function onFile(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}
		setJson(await file.text());
		setMode("paste");
	}

	async function submit() {
		const actions = eggActions(scope);
		setBusy(true);
		try {
			const result =
				mode === "paste"
					? await actions.importJson(json)
					: await actions.importUrl(url.trim());
			await invalidateEggs(queryClient);
			finish(result.id, result.warnings);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't import that egg."
			);
		} finally {
			setBusy(false);
		}
	}

	function finish(eggId: string, warnings: string[]) {
		toast.success(
			warnings.length > 0
				? `Imported as a draft — ${warnings.length} note${warnings.length === 1 ? "" : "s"} to review.`
				: "Imported as a draft. Review it before publishing."
		);
		onOpenChange(false);
		reset();
		navigate({ params: { eggId }, to: scope.editPath } as never);
	}

	const canSubmit =
		mode === "paste" ? json.trim().length > 1 : url.trim().length > 0;

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Import an egg</DialogTitle>
					<DialogDescription>
						Bring in a Pterodactyl or Pelican egg export (.json). It lands as a
						draft you can review and publish.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 py-4">
					<div className="flex items-center gap-1">
						{(["paste", "url"] as Mode[]).map((option) => (
							<Button
								key={option}
								onClick={() => setMode(option)}
								size="sm"
								type="button"
								variant={mode === option ? "secondary" : "ghost"}
							>
								{option === "paste" ? "Paste / upload" : "From URL"}
							</Button>
						))}
					</div>

					{mode === "paste" ? (
						<div className="grid gap-2">
							<div className="flex items-center justify-between">
								<Label htmlFor="import-json">Egg JSON</Label>
								<Button
									onClick={() => fileInput.current?.click()}
									size="sm"
									type="button"
									variant="outline"
								>
									<Upload className="size-3.5" /> Upload file
								</Button>
								<input
									accept="application/json,.json"
									className="hidden"
									onChange={onFile}
									ref={fileInput}
									type="file"
								/>
							</div>
							<Textarea
								className="font-mono text-xs"
								id="import-json"
								onChange={(event) => setJson(event.target.value)}
								placeholder='{ "name": "Paper", "meta": { "version": "PTDL_v2" }, ... }'
								rows={10}
								value={json}
							/>
						</div>
					) : (
						<div className="grid gap-2">
							<Label htmlFor="import-url">Egg URL</Label>
							<Input
								id="import-url"
								onChange={(event) => setUrl(event.target.value)}
								placeholder="https://raw.githubusercontent.com/.../paper.json"
								value={url}
							/>
							<p className="text-muted-foreground text-xs">
								Must be an https link to a raw egg JSON file.
							</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button
						onClick={() => onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={!canSubmit || busy} onClick={submit} type="button">
						Import
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
