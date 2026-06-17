import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	DangerRow,
	DangerRows,
	DangerZoneCard,
} from "@/components/shared/danger-zone";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { formatDate } from "@/lib/format";
import { nextOrgDestination } from "@/lib/org";
import { removeOrgLogo, uploadOrgLogo } from "@/server/org";

export const Route = createFileRoute("/_app/settings/")({
	component: SettingsGeneral,
});

/** The active organization as the auth client reports it (with members etc.). */
type ActiveOrg = NonNullable<
	ReturnType<typeof authClient.useActiveOrganization>["data"]
>;

function SettingsGeneral() {
	const { data: org } = authClient.useActiveOrganization();

	return (
		<div className="max-w-2xl space-y-6">
			<OrganizationCard org={org} />
			<DetailsCard org={org} />
			<OrgDangerZone org={org} />
		</div>
	);
}

function OrganizationCard({ org }: { org: ActiveOrg | null }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Organization</CardTitle>
				<CardDescription>Your organization's name and logo.</CardDescription>
			</CardHeader>
			{/* Keyed so the form remounts when the active org resolves/changes — the
			    name field then initializes from the loaded value. */}
			<OrganizationFormBody key={org?.id ?? "loading"} org={org} />
		</Card>
	);
}

function OrganizationFormBody({ org }: { org: ActiveOrg | null }) {
	const { refetch } = authClient.useActiveOrganization();
	const [name, setName] = useState(org?.name ?? "");
	const [saving, setSaving] = useState(false);

	const trimmed = name.trim();
	const nameDirty = !!org && trimmed.length > 0 && trimmed !== org.name;

	async function handleLogoUpload(file: File) {
		const body = new FormData();
		body.append("file", file);
		try {
			await uploadOrgLogo({ data: body });
			// The logo persists through our server fn, so the active-org query won't
			// auto-refresh — pull it explicitly.
			await refetch();
			toast.success("Logo updated.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the logo."
			);
		}
	}

	async function handleLogoRemove() {
		try {
			await removeOrgLogo();
			await refetch();
			toast.success("Logo removed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't remove the logo."
			);
		}
	}

	async function saveName() {
		setSaving(true);
		// No organizationId → the active org. The org plugin checks the caller's
		// permission (a non-admin member is rejected; surfaced below).
		const { error } = await authClient.organization.update({
			data: { name: trimmed },
		});
		setSaving(false);
		if (error) {
			toast.error(error.message ?? "Couldn't save the organization.");
			return;
		}
		toast.success("Organization saved.");
	}

	return (
		<>
			<CardContent className="space-y-6">
				<ImageUploadField
					icon={Building2}
					label="Upload logo"
					loading={!org}
					onRemove={handleLogoRemove}
					onUpload={handleLogoUpload}
					shape="square"
					value={org?.logo ?? null}
				/>
				<div className="grid gap-2">
					<Label htmlFor="org-name">Name</Label>
					{org ? (
						<Input
							id="org-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Acme Servers"
							value={name}
						/>
					) : (
						<Skeleton className="h-9 w-full" />
					)}
				</div>
			</CardContent>
			<CardFooter>
				<Button disabled={!nameDirty || saving} onClick={saveName}>
					{saving ? <Loader2 className="animate-spin" /> : null}
					Save changes
				</Button>
			</CardFooter>
		</>
	);
}

function DetailsCard({ org }: { org: ActiveOrg | null }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Identifiers for this organization.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow copyable label="Organization ID" value={org?.id} />
					<DetailRow copyable label="Slug" value={org?.slug} />
					<DetailRow
						label="Created"
						value={org ? formatDate(org.createdAt) : undefined}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}

function OrgDangerZone({ org }: { org: ActiveOrg | null }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [leaveOpen, setLeaveOpen] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	// After leaving/deleting the active org, fall through to another org the user
	// belongs to (or onboarding), resetting org-scoped caches on the way.
	async function settleAfterExit() {
		const dest = await nextOrgDestination();
		queryClient.clear();
		await navigate({ to: dest });
	}

	async function leave() {
		if (!org || busy) {
			return;
		}
		setBusy(true);
		const { error } = await authClient.organization.leave({
			organizationId: org.id,
		});
		if (error) {
			setBusy(false);
			toast.error(error.message ?? "Couldn't leave the organization.");
			return;
		}
		setLeaveOpen(false);
		toast.success(`Left “${org.name}”.`);
		await settleAfterExit();
	}

	async function remove() {
		if (!org || busy) {
			return;
		}
		setBusy(true);
		const { error } = await authClient.organization.delete({
			organizationId: org.id,
		});
		if (error) {
			setBusy(false);
			toast.error(error.message ?? "Couldn't delete the organization.");
			return;
		}
		setDeleteOpen(false);
		toast.success(`Deleted “${org.name}”.`);
		await settleAfterExit();
	}

	return (
		<DangerZoneCard description="Leaving or deleting this organization can't be undone.">
			<DangerRows>
				<DangerRow
					action={
						<Button
							disabled={!org}
							onClick={() => setLeaveOpen(true)}
							size="sm"
							variant="outline"
						>
							Leave
						</Button>
					}
					description="Remove yourself from this organization. You'll lose access until you're invited back."
					title="Leave organization"
				/>
				<DangerRow
					action={
						<Button
							disabled={!org}
							onClick={() => setDeleteOpen(true)}
							size="sm"
							variant="destructive"
						>
							Delete
						</Button>
					}
					description="Permanently delete this organization, its nodes, servers, and templates for everyone."
					title="Delete organization"
				/>
			</DangerRows>

			<Dialog onOpenChange={setLeaveOpen} open={leaveOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Leave this organization?</DialogTitle>
						<DialogDescription>
							You'll be removed from “{org?.name}” and lose access to its nodes,
							servers, and templates until someone invites you back.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy} onClick={leave}>
							{busy ? <Loader2 className="animate-spin" /> : null}
							Leave organization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete this organization?</DialogTitle>
						<DialogDescription>
							This permanently deletes “{org?.name}” along with its nodes,
							servers, and templates, for every member. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy} onClick={remove} variant="destructive">
							{busy ? <Loader2 className="animate-spin" /> : null}
							Delete organization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</DangerZoneCard>
	);
}
