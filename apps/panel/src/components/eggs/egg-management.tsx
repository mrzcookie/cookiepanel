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
import { deployBlockers, type Egg } from "@/lib/domain/eggs";
import { eggActions, invalidateEggs } from "@/lib/eggs-queries";
import type { EggScope } from "@/lib/eggs-scope";
import { eggStatus } from "@/lib/status";

/** Lifecycle + danger-zone actions for an owned egg. */
export function EggManagement({ egg, scope }: { egg: Egg; scope: EggScope }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const actions = eggActions(scope);
	const [archiveOpen, setArchiveOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	// One in-flight guard for every lifecycle action, so a double-click can't fire
	// a second publish/delete (matching the editor/import/customize flows).
	const [busy, setBusy] = useState(false);

	const blockers = deployBlockers(egg);
	const status = eggStatus(egg.status);

	async function publish() {
		if (blockers.length > 0) {
			toast.error(`Can't publish yet: ${blockers[0]}`);
			return;
		}
		setBusy(true);
		try {
			await actions.publish(egg.id);
			await invalidateEggs(queryClient);
			toast.success(
				egg.status === "published" ? "Re-published." : "Published."
			);
		} catch {
			toast.error("Couldn't publish the egg. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function unpublish(message: string) {
		setBusy(true);
		try {
			await actions.unpublish(egg.id);
			await invalidateEggs(queryClient);
			toast.success(message);
		} catch {
			toast.error("Couldn't update the egg. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function archive() {
		setBusy(true);
		try {
			await actions.archive(egg.id);
			await invalidateEggs(queryClient);
			toast.success(`Archived “${egg.name}”.`);
			setArchiveOpen(false);
		} catch {
			toast.error("Couldn't archive the egg. Try again.");
		} finally {
			setBusy(false);
		}
	}

	function exportEgg() {
		const json = JSON.stringify(
			{
				name: egg.name,
				slug: egg.slug,
				summary: egg.summary,
				description: egg.description,
				category: egg.category,
				startupCommand: egg.startupCommand,
				stop: { type: egg.stopType, value: egg.stopValue },
				doneMarkers: egg.doneMarkers,
				install: {
					script: egg.installScript,
					containerImage: egg.installContainerImage,
					entrypoint: egg.installEntrypoint,
				},
				runtimes: egg.images.map((image) => ({
					label: image.label,
					image: image.image,
					isDefault: image.isDefault,
				})),
				variables: egg.variables.map((variable) => ({
					name: variable.name,
					envVariable: variable.envVariable,
					description: variable.description,
					defaultValue: variable.defaultValue,
					type: variable.type,
					required: variable.required,
					options: variable.options,
					access: variable.access,
				})),
				features: egg.features,
			},
			null,
			2
		);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${egg.slug}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async function remove() {
		setBusy(true);
		try {
			const result = await actions.remove(egg.id);
			if (!result.ok) {
				toast.error(
					`${result.refCount} server${result.refCount === 1 ? "" : "s"} still use this egg. Archive it instead.`
				);
				setDeleteOpen(false);
				return;
			}
			await invalidateEggs(queryClient);
			toast.success(`Deleted “${egg.name}”.`);
			navigate({ to: scope.listPath as never });
		} catch {
			toast.error("Couldn't delete the egg. Try again.");
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
							Publishing lets you launch servers from this egg.
						</CardDescription>
					</div>
					<Badge variant={egg.status === "published" ? "default" : "secondary"}>
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
						{egg.status === "published" ? (
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
								{egg.status === "draft" ? "Publish" : "Re-publish"}
							</Button>
						)}
						<Button onClick={exportEgg} size="sm" variant="outline">
							<Download className="size-4" /> Export egg
						</Button>
					</div>
				</CardContent>
			</Card>

			<DangerZoneCard description="Take this egg out of the catalog, or remove it entirely.">
				<DangerRows>
					{egg.status === "archived" ? (
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
							description="Bring this egg back as a draft so you can edit and publish it again."
							title="Restore egg"
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
							title="Archive egg"
						/>
					)}
					<DangerRow
						action={
							<Button
								onClick={() => setDeleteOpen(true)}
								size="sm"
								variant="destructive"
							>
								Delete egg
							</Button>
						}
						description="Permanently remove this egg. Servers already created from it keep running on their saved copy."
						title="Delete egg"
					/>
				</DangerRows>
			</DangerZoneCard>

			<Dialog onOpenChange={setArchiveOpen} open={archiveOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Archive this egg?</DialogTitle>
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
						<DialogTitle>Delete this egg?</DialogTitle>
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
