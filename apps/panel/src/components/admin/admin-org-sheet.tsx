import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { adminOrgMembersQueryOptions } from "@/lib/admin-orgs-queries";
import type { AdminOrgRow } from "@/lib/domain/admin";
import { formatDate, initials, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
	deleteAdminOrg,
	removeAdminOrgLogo,
	updateAdminOrg,
	uploadAdminOrgLogo,
} from "@/server/orgs";

// The /admin org editor — a right-side slideout opened from a list row. The list
// already carries the full AdminOrgRow, so identity edits read and write that row
// directly (no extra fetch); the member list is fetched per-org on demand. Every
// write goes through the audited server fns and invalidates the relevant cache.
// This is a superadmin override across every tenant: org writes go direct to the
// DB because Better Auth's org plugin has no cross-org admin path (see
// src/server/orgs).

/** A square logo box (orgs use square marks, unlike the circular user avatar). */
function OrgLogo({
	className,
	logo,
}: {
	logo: string | null;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
				className
			)}
		>
			{logo ? (
				<img alt="" className="size-full object-cover" src={logo} />
			) : (
				<Building2 className="size-5 text-muted-foreground" />
			)}
		</div>
	);
}

export function AdminOrgSheet({
	onOpenChange,
	org,
}: {
	/** The selected row, or null when nothing is open. */
	org: AdminOrgRow | null;
	onOpenChange: (open: boolean) => void;
}) {
	// Keep rendering the last org through the close animation so the panel doesn't
	// blank out as `org` clears.
	const last = useRef<AdminOrgRow | null>(org);
	if (org) {
		last.current = org;
	}
	const shown = org ?? last.current;

	return (
		<Sheet onOpenChange={onOpenChange} open={!!org}>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
				{shown ? (
					// Re-key per org so every field re-initialises on switch.
					<OrgSheetBody
						key={shown.id}
						onClose={() => onOpenChange(false)}
						org={shown}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function OrgSheetBody({
	onClose,
	org,
}: {
	org: AdminOrgRow;
	onClose: () => void;
}) {
	return (
		<>
			<SheetHeader className="flex-row items-center gap-3 border-b">
				<OrgLogo logo={org.logo} />
				<div className="min-w-0 flex-1 pr-8">
					<SheetTitle className="truncate">{org.name}</SheetTitle>
					<SheetDescription className="truncate font-mono">
						{org.slug}
					</SheetDescription>
				</div>
			</SheetHeader>

			<div className="flex-1 divide-y overflow-y-auto">
				<ProfileSection org={org} />
				<DetailsSection org={org} />
				<MembersSection org={org} />
				<DangerSection onClose={onClose} org={org} />
			</div>
		</>
	);
}

/** A `// eyebrow`-titled block, hairline-separated from its neighbours. */
function Section({
	action,
	children,
	description,
	title,
}: {
	title: string;
	description?: string;
	/** Optional control aligned to the section's title row (e.g. a count). */
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="space-y-4 p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-0.5">
					<h3 className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{`// ${title}`}
					</h3>
					{description ? (
						<p className="text-muted-foreground text-xs">{description}</p>
					) : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			{children}
		</section>
	);
}

/** A label + control stacked, the form pattern used across the editor. */
function Field({
	children,
	htmlFor,
	label,
}: {
	htmlFor: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="grid gap-2">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
		</div>
	);
}

/** Invalidate the list and every per-org query in one go (prefix match). */
function useRefreshOrgs() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: ["admin", "orgs"] });
}

function ProfileSection({ org }: { org: AdminOrgRow }) {
	const refresh = useRefreshOrgs();
	const [name, setName] = useState(org.name);
	const [saving, setSaving] = useState(false);

	const trimmed = name.trim();
	const dirty = !!trimmed && trimmed !== org.name;

	async function uploadLogo(file: File) {
		const body = new FormData();
		body.append("file", file);
		body.append("orgId", org.id);
		try {
			await uploadAdminOrgLogo({ data: body });
			await refresh();
			toast.success("Logo updated.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the logo."
			);
		}
	}

	async function removeLogo() {
		try {
			await removeAdminOrgLogo({ data: { orgId: org.id } });
			await refresh();
			toast.success("Logo removed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't remove the logo."
			);
		}
	}

	async function save() {
		setSaving(true);
		try {
			await updateAdminOrg({ data: { orgId: org.id, name: trimmed } });
			await refresh();
			toast.success("Changes saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't save changes."
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Section
			description="Edit this organization's identity on behalf of its members."
			title="profile"
		>
			<ImageUploadField
				icon={Building2}
				label="Upload logo"
				onRemove={removeLogo}
				onUpload={uploadLogo}
				shape="square"
				value={org.logo}
			/>
			<Field htmlFor="org-name" label="Name">
				<Input
					id="org-name"
					onChange={(event) => setName(event.target.value)}
					placeholder="Acme Servers"
					value={name}
				/>
			</Field>
			<div className="flex justify-end">
				<Button disabled={!dirty || saving} onClick={save} size="sm">
					{saving ? <Loader2 className="animate-spin" /> : null}
					Save changes
				</Button>
			</div>
		</Section>
	);
}

function DetailsSection({ org }: { org: AdminOrgRow }) {
	return (
		<Section title="details">
			<DetailList>
				<DetailRow copyable label="Organization ID" value={org.id} />
				<DetailRow copyable label="Slug" value={org.slug} />
				<DetailRow label="Created" value={formatDate(org.createdAt)} />
				<DetailRow label="Members" value={String(org.memberCount)} />
				<DetailRow label="Nodes" value={String(org.nodeCount)} />
			</DetailList>
		</Section>
	);
}

function MembersSection({ org }: { org: AdminOrgRow }) {
	const { data: members, isPending } = useQuery(
		adminOrgMembersQueryOptions(org.id)
	);

	return (
		<Section
			description="People in this organization and their role here."
			title="members"
		>
			{isPending ? (
				<SkeletonRows />
			) : members && members.length > 0 ? (
				<ul className="divide-y">
					{members.map((member) => (
						<li
							className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
							key={member.id}
						>
							<div className="flex min-w-0 items-center gap-3">
								<Avatar className="size-8">
									{member.image ? (
										<AvatarImage alt="" src={member.image} />
									) : null}
									<AvatarFallback>{initials(member.name)}</AvatarFallback>
								</Avatar>
								<div className="min-w-0">
									<div className="truncate font-medium text-sm">
										{member.name}
									</div>
									<div className="truncate text-muted-foreground text-xs">
										{member.email}
									</div>
								</div>
							</div>
							<Badge className="shrink-0 capitalize" variant="secondary">
								{member.role}
							</Badge>
						</li>
					))}
				</ul>
			) : (
				<p className="text-muted-foreground text-sm">No members.</p>
			)}
		</Section>
	);
}

function DangerSection({
	onClose,
	org,
}: {
	org: AdminOrgRow;
	onClose: () => void;
}) {
	const refresh = useRefreshOrgs();
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmText, setConfirmText] = useState("");
	const canDelete = confirmText.trim() === org.slug;

	async function remove() {
		setBusy(true);
		try {
			await deleteAdminOrg({ data: { orgId: org.id } });
			setConfirmOpen(false);
			toast.success(`Deleted “${org.name}”.`);
			onClose();
			await refresh();
		} catch (error) {
			setBusy(false);
			toast.error(
				error instanceof Error
					? error.message
					: "Couldn't delete the organization."
			);
		}
	}

	return (
		<Section
			description="This action applies across the whole platform."
			title="danger zone"
		>
			<div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 p-3">
				<div className="min-w-0">
					<div className="font-medium text-sm">Delete organization</div>
					<div className="text-muted-foreground text-xs">
						Permanently remove this organization, its{" "}
						{pluralize(org.memberCount, "member")}, and its{" "}
						{pluralize(org.nodeCount, "node")}. This can't be undone.
					</div>
				</div>
				<Button
					className="shrink-0"
					onClick={() => {
						setConfirmText("");
						setConfirmOpen(true);
					}}
					size="sm"
					variant="destructive"
				>
					Delete
				</Button>
			</div>

			<AlertDialog
				onOpenChange={(open) => {
					setConfirmOpen(open);
					if (!open) {
						setConfirmText("");
					}
				}}
				open={confirmOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this organization?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes “{org.name}” along with its members,
							nodes, servers, and templates, for everyone. This can't be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="grid gap-2">
						<Label htmlFor="confirm-delete-org">
							Type <span className="font-mono text-foreground">{org.slug}</span>{" "}
							to confirm
						</Label>
						<Input
							autoComplete="off"
							id="confirm-delete-org"
							onChange={(event) => setConfirmText(event.target.value)}
							placeholder={org.slug}
							value={confirmText}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel asChild>
							<Button disabled={busy} type="button" variant="outline">
								Cancel
							</Button>
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								disabled={busy || !canDelete}
								onClick={(event) => {
									// Keep the dialog open while the request runs; `remove` closes
									// it on success and leaves it up (with a toast) on failure.
									event.preventDefault();
									remove();
								}}
								variant="destructive"
							>
								{busy ? <Loader2 className="animate-spin" /> : null}
								Delete organization
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Section>
	);
}

/** Two placeholder rows while the members list loads. */
function SkeletonRows() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-10 w-full" />
		</div>
	);
}
