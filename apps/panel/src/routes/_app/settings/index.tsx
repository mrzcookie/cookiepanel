import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { removeOrgLogo, uploadOrgLogo } from "@/server/organization";

export const Route = createFileRoute("/_app/settings/")({
	component: SettingsGeneral,
});

/** The active organization as the auth client reports it (with members etc.). */
type ActiveOrg = NonNullable<
	ReturnType<typeof authClient.useActiveOrganization>["data"]
>;

function SettingsGeneral() {
	const { data: org } = authClient.useActiveOrganization();
	const { data: session } = authClient.useSession();

	const role = org?.members.find(
		(member) => member.userId === session?.user.id
	)?.role;
	// owner/admin hold the "update" permission (name + logo); only owner holds
	// "delete". Better Auth enforces the same server-side — this just hides
	// controls that would otherwise fail for a plain member.
	const canManage =
		!!role && (role.includes("owner") || role.includes("admin"));
	const canDelete = !!role && role.includes("owner");
	// Keep the editable shell (with its skeletons) until both the org and the
	// session resolve, so a manager never flashes the read-only view first.
	const ready = !!org && !!session;

	return (
		<div className="max-w-2xl space-y-6">
			<OrganizationCard editable={!ready || canManage} org={org} />
			<DetailsCard org={org} />
			<OrgExitCard mode={canDelete ? "delete" : "leave"} org={org} />
		</div>
	);
}

function OrganizationCard({
	org,
	editable,
}: {
	org: ActiveOrg | null;
	editable: boolean;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Organization</CardTitle>
				<CardDescription>Your organization's name and logo.</CardDescription>
			</CardHeader>
			{editable ? (
				// Keyed so the form remounts when the active org resolves/changes — the
				// name field then initializes from the loaded value.
				<OrganizationFormBody key={org?.id ?? "loading"} org={org} />
			) : (
				<OrganizationReadOnly org={org} />
			)}
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
		// No organizationId → the active org.
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

/** Read-only org identity for members without the "update" permission. */
function OrganizationReadOnly({ org }: { org: ActiveOrg | null }) {
	return (
		<CardContent>
			<div className="flex items-center gap-4">
				<Avatar className="size-16 rounded-md after:rounded-md">
					{org?.logo ? (
						<AvatarImage alt="" className="rounded-md" src={org.logo} />
					) : null}
					<AvatarFallback className="rounded-md">
						<Building2 className="size-7" />
					</AvatarFallback>
				</Avatar>
				<div className="min-w-0 space-y-1">
					{org ? (
						<p className="font-medium">{org.name}</p>
					) : (
						<Skeleton className="h-5 w-40" />
					)}
					<p className="text-muted-foreground text-sm">
						Only owners and admins can change the name and logo.
					</p>
				</div>
			</div>
		</CardContent>
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

/**
 * Leaving or deleting the active org both end the same way: fall through to
 * another org the user belongs to (or onboarding), resetting org-scoped caches.
 */
function useSettleAfterExit() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return async () => {
		const dest = await nextOrgDestination();
		queryClient.clear();
		await navigate({ to: dest });
	};
}

/**
 * The org exit card — one action, since the two are mutually exclusive: an
 * **owner** deletes the org (leaving would orphan it), everyone else leaves. It's
 * a single action, so it's titled for what it does rather than "Danger zone".
 */
function OrgExitCard({
	org,
	mode,
}: {
	org: ActiveOrg | null;
	mode: "leave" | "delete";
}) {
	const settleAfterExit = useSettleAfterExit();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const isDelete = mode === "delete";

	async function confirm() {
		if (!org || busy) {
			return;
		}
		setBusy(true);
		const { error } = isDelete
			? await authClient.organization.delete({ organizationId: org.id })
			: await authClient.organization.leave({ organizationId: org.id });
		if (error) {
			setBusy(false);
			toast.error(
				error.message ??
					(isDelete
						? "Couldn't delete the organization."
						: "Couldn't leave the organization.")
			);
			return;
		}
		setOpen(false);
		toast.success(isDelete ? `Deleted “${org.name}”.` : `Left “${org.name}”.`);
		await settleAfterExit();
	}

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-destructive">
					{isDelete ? "Delete organization" : "Leave organization"}
				</CardTitle>
				<CardDescription>
					{isDelete
						? "Permanently delete this organization, its nodes, servers, and templates for everyone. This can't be undone."
						: "Remove yourself from this organization. You'll lose access to its nodes, servers, and templates until someone invites you back."}
				</CardDescription>
			</CardHeader>
			<CardFooter>
				<Button
					disabled={!org}
					onClick={() => setOpen(true)}
					variant="destructive"
				>
					{isDelete ? "Delete organization" : "Leave organization"}
				</Button>
			</CardFooter>

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{isDelete
								? "Delete this organization?"
								: "Leave this organization?"}
						</DialogTitle>
						<DialogDescription>
							{isDelete
								? `This permanently deletes “${org?.name}” along with its nodes, servers, and templates, for every member. This can't be undone.`
								: `You'll be removed from “${org?.name}” and lose access to its nodes, servers, and templates until someone invites you back.`}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={busy} onClick={confirm} variant="destructive">
							{busy ? <Loader2 className="animate-spin" /> : null}
							{isDelete ? "Delete organization" : "Leave organization"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
