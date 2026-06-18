import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Monitor, UserRound } from "lucide-react";
import { type ComponentType, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { GitHubIcon, GoogleIcon } from "@/components/auth/provider-icons";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { StatusIndicator } from "@/components/shared/status-indicator";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	adminUserAccountsQueryOptions,
	adminUserSessionsQueryOptions,
} from "@/lib/admin-users-queries";
import type {
	AdminPlatformRole,
	AdminUserConnection,
	AdminUserRow,
	AdminUserSession,
	AdminUserStatus,
} from "@/lib/domain/admin";
import { formatDate, formatRelativeTime, initials } from "@/lib/format";
import type { StatusMeta } from "@/lib/status";

import {
	deleteAdminUser,
	removeAdminUserAvatar,
	revokeAdminUserSession,
	revokeAdminUserSessions,
	setAdminUserAvatar,
	setAdminUserRole,
	setAdminUserStatus,
	unlinkAdminUserAccount,
	updateAdminUser,
} from "@/server/users";

// The /admin user editor — a right-side slideout opened from a list row. The list
// already carries the full AdminUserRow, so identity + profile edits read and
// write that row directly (no extra fetch); the linked logins and active sessions
// are fetched per-user on demand. Every write goes through the audited server fns
// and invalidates the relevant cache. This is a superadmin override: there are no
// self-action guards — an admin can edit, ban, or delete any account here,
// including their own.

/** Account standing as a bracket status chip. "Banned" == the suspended status
 * (Better Auth's ban), surfaced with the operator's word for it. */
function accountStatus(status: AdminUserStatus): StatusMeta {
	return status === "suspended"
		? { label: "Banned", tone: "error" }
		: { label: "Active", tone: "online" };
}

/** Display label + brand mark per OAuth provider; unknown keys fall back. */
const PROVIDER_META: Record<
	string,
	{ label: string; icon: ComponentType<{ className?: string }> }
> = {
	google: { label: "Google", icon: GoogleIcon },
	github: { label: "GitHub", icon: GitHubIcon },
};

function providerMeta(providerId: string) {
	return (
		PROVIDER_META[providerId] ?? {
			label: providerId.charAt(0).toUpperCase() + providerId.slice(1),
			icon: KeyRound,
		}
	);
}

/** A friendly "Browser on OS" label from a raw user-agent (full string on hover). */
function describeUserAgent(userAgent: string | null): string {
	if (!userAgent) {
		return "Unknown device";
	}
	const browser = /edg/i.test(userAgent)
		? "Edge"
		: /chrome|crios/i.test(userAgent)
			? "Chrome"
			: /firefox|fxios/i.test(userAgent)
				? "Firefox"
				: /safari/i.test(userAgent)
					? "Safari"
					: null;
	const os = /windows/i.test(userAgent)
		? "Windows"
		: /iphone|ipad|ipod/i.test(userAgent)
			? "iOS"
			: /mac os x|macintosh/i.test(userAgent)
				? "macOS"
				: /android/i.test(userAgent)
					? "Android"
					: /linux/i.test(userAgent)
						? "Linux"
						: null;
	if (browser && os) {
		return `${browser} on ${os}`;
	}
	return browser ?? os ?? "Unknown device";
}

export function AdminUserSheet({
	onOpenChange,
	user,
}: {
	/** The selected row, or null when nothing is open. */
	user: AdminUserRow | null;
	onOpenChange: (open: boolean) => void;
}) {
	// Keep rendering the last user through the close animation so the panel
	// doesn't blank out as `user` clears.
	const last = useRef<AdminUserRow | null>(user);
	if (user) {
		last.current = user;
	}
	const shown = user ?? last.current;

	return (
		<Sheet onOpenChange={onOpenChange} open={!!user}>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
				{shown ? (
					// Re-key per account so every field re-initialises on switch.
					<UserSheetBody
						key={shown.id}
						onClose={() => onOpenChange(false)}
						user={shown}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function UserSheetBody({
	onClose,
	user,
}: {
	user: AdminUserRow;
	onClose: () => void;
}) {
	return (
		<>
			<SheetHeader className="flex-row items-center gap-3 border-b">
				<Avatar className="size-11">
					{user.image ? <AvatarImage alt="" src={user.image} /> : null}
					<AvatarFallback>{initials(user.name)}</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1 pr-8">
					<SheetTitle className="truncate">{user.name}</SheetTitle>
					<SheetDescription className="truncate">{user.email}</SheetDescription>
					<div className="flex flex-wrap items-center gap-2 pt-1.5">
						<StatusIndicator status={accountStatus(user.status)} />
						{user.role === "admin" ? (
							<Badge variant="secondary">Admin</Badge>
						) : null}
					</div>
				</div>
			</SheetHeader>

			<div className="flex-1 divide-y overflow-y-auto">
				<ProfileSection user={user} />
				<DetailsSection user={user} />
				<ConnectionsSection user={user} />
				<SessionsSection user={user} />
				<OrganizationsSection user={user} />
				<DangerSection onClose={onClose} user={user} />
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

/** A bordered row carrying a title + description and a trailing action. */
function ActionRow({
	action,
	description,
	icon,
	title,
	trailing,
}: {
	title: ReactNode;
	description: string;
	action: ReactNode;
	icon?: ReactNode;
	/** A badge or marker shown next to the title. */
	trailing?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
			<div className="flex min-w-0 items-start gap-2.5">
				{icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium text-sm">{title}</span>
						{trailing}
					</div>
					<div className="truncate text-muted-foreground text-xs">
						{description}
					</div>
				</div>
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	);
}

/** Invalidate the list and every per-user query in one go (prefix match). */
function useRefreshUsers() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
}

function ProfileSection({ user }: { user: AdminUserRow }) {
	const refresh = useRefreshUsers();
	const [name, setName] = useState(user.name);
	const [email, setEmail] = useState(user.email);
	const [verified, setVerified] = useState(user.emailVerified);
	const [role, setRole] = useState<AdminPlatformRole>(user.role);
	const [saving, setSaving] = useState(false);

	const trimmedName = name.trim();
	const trimmedEmail = email.trim();
	const profileDirty =
		trimmedName !== user.name ||
		trimmedEmail !== user.email ||
		verified !== user.emailVerified;
	const roleDirty = role !== user.role;
	const valid = !!trimmedName && !!trimmedEmail;
	const dirty = (profileDirty || roleDirty) && valid;
	const init = initials(user.name);

	async function uploadAvatar(file: File) {
		const body = new FormData();
		body.append("file", file);
		body.append("userId", user.id);
		try {
			await setAdminUserAvatar({ data: body });
			await refresh();
			toast.success("Avatar updated.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the avatar."
			);
		}
	}

	async function removeAvatar() {
		try {
			await removeAdminUserAvatar({ data: { userId: user.id } });
			await refresh();
			toast.success("Avatar removed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't remove the avatar."
			);
		}
	}

	async function save() {
		setSaving(true);
		try {
			// Identity write (name/email/verified) and the role write are distinct,
			// separately-audited actions — send each only when it actually changed.
			if (profileDirty) {
				await updateAdminUser({
					data: {
						userId: user.id,
						...(trimmedName !== user.name ? { name: trimmedName } : {}),
						...(trimmedEmail !== user.email ? { email: trimmedEmail } : {}),
						...(verified !== user.emailVerified
							? { emailVerified: verified }
							: {}),
					},
				});
			}
			if (roleDirty) {
				await setAdminUserRole({ data: { userId: user.id, role } });
			}
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
			description="Override this account's identity directly — these edits skip the usual email and verification confirmations."
			title="profile"
		>
			<ImageUploadField
				fallback={
					init ? <span className="font-medium text-xl">{init}</span> : undefined
				}
				icon={UserRound}
				label="Upload avatar"
				onRemove={removeAvatar}
				onUpload={uploadAvatar}
				shape="circle"
				value={user.image}
			/>
			<Field htmlFor="user-name" label="Name">
				<Input
					id="user-name"
					onChange={(event) => setName(event.target.value)}
					placeholder="Jane Cooper"
					value={name}
				/>
			</Field>
			<Field htmlFor="user-email" label="Email">
				<Input
					id="user-email"
					onChange={(event) => setEmail(event.target.value)}
					placeholder="jane@example.com"
					type="email"
					value={email}
				/>
			</Field>
			<Field htmlFor="user-role" label="Platform role">
				<Select
					onValueChange={(value) => setRole(value as AdminPlatformRole)}
					value={role}
				>
					<SelectTrigger className="w-full" id="user-role">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="user">User</SelectItem>
						<SelectItem value="admin">Admin</SelectItem>
					</SelectContent>
				</Select>
			</Field>
			<div className="flex items-center justify-between gap-4 rounded-md border border-border/60 p-3">
				<div className="space-y-0.5">
					<Label htmlFor="user-verified">Email verified</Label>
					<p className="text-muted-foreground text-xs">
						Mark this address verified, or revoke it, without sending a link.
					</p>
				</div>
				<Switch
					checked={verified}
					id="user-verified"
					onCheckedChange={setVerified}
				/>
			</div>
			<div className="flex justify-end">
				<Button disabled={!dirty || saving} onClick={save} size="sm">
					{saving ? <Loader2 className="animate-spin" /> : null}
					Save changes
				</Button>
			</div>
		</Section>
	);
}

function DetailsSection({ user }: { user: AdminUserRow }) {
	return (
		<Section title="details">
			<DetailList>
				<DetailRow copyable label="User ID" value={user.id} />
				<DetailRow label="Joined" value={formatDate(user.createdAt)} />
				<DetailRow
					label="Last seen"
					value={
						user.lastSeenAt ? formatRelativeTime(user.lastSeenAt) : "Never"
					}
				/>
			</DetailList>
		</Section>
	);
}

function ConnectionsSection({ user }: { user: AdminUserRow }) {
	const queryClient = useQueryClient();
	const { data: connections, isPending } = useQuery(
		adminUserAccountsQueryOptions(user.id)
	);
	const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

	async function unlink(connection: AdminUserConnection) {
		const { label } = providerMeta(connection.providerId);
		setUnlinkingId(connection.id);
		try {
			await unlinkAdminUserAccount({
				data: { userId: user.id, accountId: connection.id },
			});
			await queryClient.invalidateQueries({
				queryKey: ["admin", "users", user.id, "accounts"],
			});
			toast.success(`Disconnected ${label}.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : `Couldn't disconnect ${label}.`
			);
		} finally {
			setUnlinkingId(null);
		}
	}

	return (
		<Section
			description="Social logins linked to this account."
			title="connections"
		>
			{isPending ? (
				<SkeletonRows />
			) : connections && connections.length > 0 ? (
				<div className="divide-y">
					{connections.map((connection) => {
						const { label, icon: Icon } = providerMeta(connection.providerId);
						return (
							<ActionRow
								action={
									<Button
										disabled={unlinkingId === connection.id}
										onClick={() => unlink(connection)}
										size="sm"
										variant="outline"
									>
										{unlinkingId === connection.id ? (
											<Loader2 className="animate-spin" />
										) : null}
										Disconnect
									</Button>
								}
								description={`Linked ${formatDate(connection.linkedAt)}`}
								icon={<Icon className="size-4" />}
								key={connection.id}
								title={label}
							/>
						);
					})}
				</div>
			) : (
				<p className="text-muted-foreground text-sm">
					No linked social logins.
				</p>
			)}
		</Section>
	);
}

function SessionsSection({ user }: { user: AdminUserRow }) {
	const queryClient = useQueryClient();
	const { data: sessions, isPending } = useQuery(
		adminUserSessionsQueryOptions(user.id)
	);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [clearing, setClearing] = useState(false);
	const count = sessions?.length ?? 0;

	function invalidate() {
		return queryClient.invalidateQueries({
			queryKey: ["admin", "users", user.id, "sessions"],
		});
	}

	async function revoke(session: AdminUserSession) {
		setRevokingId(session.id);
		try {
			await revokeAdminUserSession({
				data: { userId: user.id, sessionId: session.id },
			});
			await invalidate();
			toast.success("Session revoked.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't revoke the session."
			);
		} finally {
			setRevokingId(null);
		}
	}

	async function clearAll() {
		setClearing(true);
		try {
			await revokeAdminUserSessions({ data: { userId: user.id } });
			await invalidate();
			toast.success(`Cleared all sessions for “${user.name}”.`);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't clear the sessions."
			);
		} finally {
			setClearing(false);
		}
	}

	return (
		<Section
			action={
				count > 0 ? (
					<Button
						disabled={clearing}
						onClick={clearAll}
						size="sm"
						variant="outline"
					>
						{clearing ? <Loader2 className="animate-spin" /> : null}
						Clear all
					</Button>
				) : null
			}
			description="Devices with an active session. Revoke one, or clear them all."
			title="sessions"
		>
			{isPending ? (
				<SkeletonRows />
			) : count > 0 && sessions ? (
				<div className="divide-y">
					{sessions.map((session) => (
						<ActionRow
							action={
								<Button
									disabled={revokingId === session.id}
									onClick={() => revoke(session)}
									size="sm"
									variant="outline"
								>
									{revokingId === session.id ? (
										<Loader2 className="animate-spin" />
									) : null}
									Revoke
								</Button>
							}
							description={`${session.ipAddress ?? "Unknown IP"} · Started ${formatDate(session.createdAt)}`}
							icon={<Monitor className="size-4 text-muted-foreground" />}
							key={session.id}
							title={
								<span title={session.userAgent ?? undefined}>
									{describeUserAgent(session.userAgent)}
								</span>
							}
							trailing={
								session.isCurrent ? (
									<Badge variant="secondary">This device</Badge>
								) : null
							}
						/>
					))}
				</div>
			) : (
				<p className="text-muted-foreground text-sm">No active sessions.</p>
			)}
		</Section>
	);
}

function OrganizationsSection({ user }: { user: AdminUserRow }) {
	return (
		<Section
			description="Organizations this account belongs to."
			title="organizations"
		>
			{user.memberships.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Not a member of any organization.
				</p>
			) : (
				<ul className="divide-y">
					{user.memberships.map((membership) => (
						// Not linked: the orgs console is a slideout opened from its list,
						// not a per-org route, so there's no URL to deep-link to here.
						<li
							className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
							key={membership.orgId}
						>
							<span className="truncate font-medium text-sm">
								{membership.orgName}
							</span>
							<Badge className="capitalize" variant="secondary">
								{membership.role}
							</Badge>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
}

function DangerSection({
	onClose,
	user,
}: {
	user: AdminUserRow;
	onClose: () => void;
}) {
	const refresh = useRefreshUsers();
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmText, setConfirmText] = useState("");
	const banned = user.status === "suspended";
	const canDelete =
		confirmText.trim().toLowerCase() === user.email.trim().toLowerCase();

	async function toggleBan() {
		setBusy(true);
		try {
			await setAdminUserStatus({
				data: { userId: user.id, status: banned ? "active" : "suspended" },
			});
			await refresh();
			toast.success(
				banned ? `Unbanned “${user.name}”.` : `Banned “${user.name}”.`
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the account."
			);
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		setBusy(true);
		try {
			await deleteAdminUser({ data: { userId: user.id } });
			setConfirmOpen(false);
			toast.success(`Deleted “${user.name}”.`);
			onClose();
			await refresh();
		} catch (error) {
			setBusy(false);
			toast.error(
				error instanceof Error ? error.message : "Couldn't delete the account."
			);
		}
	}

	return (
		<Section
			description="These actions apply across the whole platform."
			title="danger zone"
		>
			<div className="divide-y rounded-md border border-destructive/40 p-3">
				<ActionRow
					action={
						<Button
							disabled={busy}
							onClick={toggleBan}
							size="sm"
							variant="outline"
						>
							{busy ? <Loader2 className="animate-spin" /> : null}
							{banned ? "Unban" : "Ban"}
						</Button>
					}
					description={
						banned
							? "Restore this account's access to the platform."
							: "Block this account from signing in and end its sessions. Their organizations and servers keep running."
					}
					title={banned ? "Unban account" : "Ban account"}
				/>
				<ActionRow
					action={
						<Button
							onClick={() => {
								setConfirmText("");
								setConfirmOpen(true);
							}}
							size="sm"
							variant="destructive"
						>
							Delete
						</Button>
					}
					description="Permanently remove this account, its memberships, and its sessions. This can't be undone."
					title="Delete account"
				/>
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
						<AlertDialogTitle>Delete this account?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes the account for {user.name} and removes
							them from every organization and session. This can't be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="grid gap-2">
						<Label htmlFor="confirm-delete">
							Type{" "}
							<span className="font-mono text-foreground">{user.email}</span> to
							confirm
						</Label>
						<Input
							autoComplete="off"
							id="confirm-delete"
							onChange={(event) => setConfirmText(event.target.value)}
							placeholder={user.email}
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
								Delete account
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Section>
	);
}

/** Two placeholder rows while a per-user list (connections / sessions) loads. */
function SkeletonRows() {
	return (
		<div className="space-y-3">
			<Skeleton className="h-10 w-full" />
			<Skeleton className="h-10 w-full" />
		</div>
	);
}
