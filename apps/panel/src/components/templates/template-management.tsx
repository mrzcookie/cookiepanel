import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	DangerRow,
	DangerRows,
	DangerZoneCard,
} from "@/components/shared/danger-zone";
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
import { deployBlockers, type Template } from "@/lib/domain/templates";
import { templateStatus } from "@/lib/status";
import { invalidateTemplates, templateActions } from "@/lib/templates-queries";
import type { TemplateScope } from "@/lib/templates-scope";

/** Lifecycle + danger-zone actions for an owned template. */
export function TemplateManagement({
	template,
	scope,
}: {
	template: Template;
	scope: TemplateScope;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const actions = templateActions(scope);
	const [archiveOpen, setArchiveOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// One in-flight guard for every lifecycle action, so a double-click can't fire
	// a second publish/delete (matching the editor/import/customize flows).
	const [busy, setBusy] = useState(false);

	const blockers = deployBlockers(template);
	const status = templateStatus(template.status);

	async function publish() {
		if (blockers.length > 0) {
			toast.error(`Can't publish yet: ${blockers[0]}`);
			return;
		}
		setBusy(true);
		try {
			await actions.publish(template.id);
			await invalidateTemplates(queryClient);
			toast.success(
				template.status === "published" ? "Re-published." : "Published."
			);
		} catch {
			toast.error("Couldn't publish the template. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function unpublish(message: string) {
		setBusy(true);
		try {
			await actions.unpublish(template.id);
			await invalidateTemplates(queryClient);
			toast.success(message);
		} catch {
			toast.error("Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function archive() {
		setBusy(true);
		try {
			await actions.archive(template.id);
			await invalidateTemplates(queryClient);
			toast.success("Archived.");
			setArchiveOpen(false);
		} catch {
			toast.error("Couldn't archive the template. Try again.");
		} finally {
			setBusy(false);
		}
	}

	function exportEgg() {
		const json = JSON.stringify(
			{
				name: template.name,
				slug: template.slug,
				summary: template.summary,
				description: template.description,
				category: template.category,
				startupCommand: template.startupCommand,
				stop: { type: template.stopType, value: template.stopValue },
				doneMarkers: template.doneMarkers,
				install: {
					script: template.installScript,
					containerImage: template.installContainerImage,
					entrypoint: template.installEntrypoint,
				},
				runtimes: template.images.map((image) => ({
					label: image.label,
					image: image.image,
					isDefault: image.isDefault,
				})),
				variables: template.variables.map((variable) => ({
					name: variable.name,
					envVariable: variable.envVariable,
					description: variable.description,
					defaultValue: variable.defaultValue,
					type: variable.type,
					required: variable.required,
					options: variable.options,
					access: variable.access,
				})),
				features: template.features,
			},
			null,
			2
		);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${template.slug}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function remove() {
		setBusy(true);
		try {
			const result = await actions.remove(template.id);
			if (!result.ok) {
				toast.error(
					`${result.refCount} server${result.refCount === 1 ? "" : "s"} still use this template. Archive it instead.`
				);
				setDeleteOpen(false);
				return;
			}
			await invalidateTemplates(queryClient);
			toast.success("Template deleted.");
			navigate({ to: scope.listPath as never });
		} catch {
			toast.error("Couldn't delete the template. Try again.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
					<div className="space-y-1.5">
						<CardTitle>Publish</CardTitle>
						<CardDescription>
							Publishing lets you launch servers from this template.
						</CardDescription>
					</div>
					<Badge
						variant={template.status === "published" ? "default" : "secondary"}
					>
						{status.label}
					</Badge>
				</CardHeader>
				<CardContent className="space-y-4">
					{blockers.length > 0 ? (
						<ul className="space-y-1 text-muted-foreground text-sm">
							{blockers.map((blocker) => (
								<li key={blocker}>• {blocker}</li>
							))}
						</ul>
					) : (
						<p className="text-muted-foreground text-sm">Ready to deploy.</p>
					)}

					<div className="flex flex-wrap gap-2">
						{template.status === "published" ? (
							<Button
								disabled={busy}
								onClick={() => unpublish("Moved back to draft.")}
								size="sm"
								variant="outline"
							>
								Unpublish
							</Button>
						) : (
							<Button
								disabled={busy || blockers.length > 0}
								onClick={publish}
								size="sm"
							>
								{template.status === "draft" ? "Publish" : "Re-publish"}
							</Button>
						)}
						<Button onClick={exportEgg} size="sm" variant="outline">
							<Download className="size-4" /> Export template
						</Button>
					</div>
				</CardContent>
			</Card>

			<DangerZoneCard description="Take this template out of the catalog, or remove it entirely.">
				<DangerRows>
					{template.status === "archived" ? (
						<DangerRow
							action={
								<Button
									disabled={busy}
									onClick={() => unpublish("Restored to draft.")}
									size="sm"
									variant="outline"
								>
									Restore
								</Button>
							}
							description="Bring this template back as a draft so you can edit and publish it again."
							title="Restore template"
						/>
					) : (
						<DangerRow
							action={
								<Button
									onClick={() => setArchiveOpen(true)}
									size="sm"
									variant="outline"
								>
									Archive
								</Button>
							}
							description="Take it out of the catalog so no new servers can be created from it. Existing servers are unaffected."
							title="Archive template"
						/>
					)}
					<DangerRow
						action={
							<Button
								onClick={() => setDeleteOpen(true)}
								size="sm"
								variant="destructive"
							>
								Delete template
							</Button>
						}
						description="Permanently remove this template. Servers already created from it keep running on their saved copy."
						title="Delete template"
					/>
				</DangerRows>
			</DangerZoneCard>

			<Dialog onOpenChange={setArchiveOpen} open={archiveOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Archive this template?</DialogTitle>
						<DialogDescription>
							It leaves the catalog so no new servers can be created from it.
							Servers already running on it are unaffected, and you can restore
							it later.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy} onClick={archive} type="button">
							Archive
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this template?</DialogTitle>
						<DialogDescription>
							This can't be undone. Servers already created from it keep running
							on their saved copy.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							disabled={busy}
							onClick={remove}
							type="button"
							variant="destructive"
						>
							Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
