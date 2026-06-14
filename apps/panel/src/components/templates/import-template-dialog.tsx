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
import { importTemplate } from "@/lib/templates-store";

type Mode = "paste" | "url";

/** Pull a friendly name out of pasted egg JSON, if one is obvious. */
function nameFromJson(json: string): string | null {
	try {
		const parsed = JSON.parse(json) as { name?: unknown };
		return typeof parsed.name === "string" && parsed.name.trim()
			? parsed.name.trim()
			: null;
	} catch {
		return null;
	}
}

/** Derive a name from a URL's filename (e.g. egg-paper.json → "egg paper"). */
function nameFromUrl(url: string): string {
	const last = url.split("/").pop() ?? "";
	const base = last.replace(/\.json$/i, "").replace(/^egg-/i, "");
	return base.replace(/[-_]+/g, " ").trim() || "Imported template";
}

/**
 * Import a Pterodactyl/Pelican egg by pasting/uploading JSON or from a URL.
 * UI-first stub: it lands a draft (lifting a name when one is obvious) and opens
 * the editor; real parsing of the full egg lands with the data layer.
 */
export function ImportTemplateDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const fileInput = useRef<HTMLInputElement>(null);
	const [mode, setMode] = useState<Mode>("paste");
	const [json, setJson] = useState("");
	const [url, setUrl] = useState("");

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

	function submit() {
		if (mode === "paste") {
			const name = nameFromJson(json);
			if (!name) {
				toast.error("That doesn't look like valid template JSON.");
				return;
			}
			const created = importTemplate(name);
			finish(created.id);
		} else {
			const trimmed = url.trim();
			if (!trimmed) {
				toast.error("Enter a URL.");
				return;
			}
			const created = importTemplate(nameFromUrl(trimmed));
			finish(created.id);
		}
	}

	function finish(templateId: string) {
		toast.success("Imported as a draft. Review it before publishing.");
		onOpenChange(false);
		reset();
		navigate({ params: { templateId }, to: "/templates/$templateId/edit" });
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
					<DialogTitle>Import a template</DialogTitle>
					<DialogDescription>
						Bring in a Pterodactyl or Pelican template export (.json). It lands
						as a draft you can review and publish.
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
								<Label htmlFor="import-json">Template JSON</Label>
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
							<Label htmlFor="import-url">Template URL</Label>
							<Input
								id="import-url"
								onChange={(event) => setUrl(event.target.value)}
								placeholder="https://raw.githubusercontent.com/.../paper.json"
								value={url}
							/>
							<p className="text-muted-foreground text-xs">
								Must be an https link to a raw template JSON file.
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
					<Button disabled={!canSubmit} onClick={submit} type="button">
						Import
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
