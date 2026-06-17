import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	notFound,
	useNavigate,
} from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/layout/error-screen";
import {
	DangerRow,
	DangerRows,
	DangerZoneCard,
} from "@/components/shared/danger-zone";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { adminUserQueryOptions } from "@/lib/admin-users-queries";
import { authClient } from "@/lib/auth-client";
import type { AdminPlatformRole, AdminUserRow } from "@/lib/domain/admin";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { userStatus } from "@/lib/status";
import {
	deleteAdminUser,
	setAdminUserRole,
	setAdminUserStatus,
	updateAdminUser,
} from "@/server/users";

export const Route = createFileRoute("/admin/users/$userId")({
	loader: async ({ context, params }) => {
		try {
			await context.queryClient.ensureQueryData(
				adminUserQueryOptions(params.userId)
			);
		} catch (error) {
			// A missing user is a tailored 404; anything else bubbles to the admin
			// shell's 500 boundary (a generic not-found keeps ids unprobeable).
			if (error instanceof Error && error.message === "Not found") {
				throw notFound();
			}
			throw error;
		}
	},
	notFoundComponent: () => (
		<ErrorScreen
			action={
				<Button asChild size="sm" variant="outline">
					<Link to="/admin/users">Back to users</Link>
				</Button>
			}
			className="min-h-[70vh]"
			code="404"
			description="It may have been removed, or you followed an old link."
			title="User not found"
			tone="muted"
		/>
	),
	component: AdminUserDetail,
});

function AdminUserDetail() {
	const { userId } = Route.useParams();
	const { data: user } = useSuspenseQuery(adminUserQueryOptions(userId));
	const { data: session } = authClient.useSession();

	return <UserView isSelf={session?.user.id === user.id} user={user} />;
}

/** Invalidate the list and every detail query in one go (prefix match). */
function useRefreshUsers() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
}

function UserView({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
	return (
		<>
			<PageHeader
				actions={<StatusIndicator status={userStatus(user.status)} />}
				back={{ label: "Users", to: "/admin/users" }}
				description={user.email}
				title={user.name}
			/>

			<div className="max-w-2xl space-y-6">
				<ProfileCard user={user} />
				<DetailsCard user={user} />
				<AccessCard isSelf={isSelf} user={user} />
				<OrganizationsCard user={user} />
				<DangerCard isSelf={isSelf} user={user} />
			</div>
		</>
	);
}

function ProfileCard({ user }: { user: AdminUserRow }) {
	const refresh = useRefreshUsers();
	const [name, setName] = useState(user.name);
	const [email, setEmail] = useState(user.email);
	const [verified, setVerified] = useState(user.emailVerified);
	const [saving, setSaving] = useState(false);

	const trimmedName = name.trim();
	const trimmedEmail = email.trim();
	const dirty =
		!!trimmedName &&
		!!trimmedEmail &&
		(trimmedName !== user.name ||
			trimmedEmail !== user.email ||
			verified !== user.emailVerified);

	async function save() {
		setSaving(true);
		try {
			// Send only what changed (an email write is a verified-flow concern, so
			// don't re-apply an unchanged address).
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
			await refresh();
			toast.success("Profile saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't save the profile."
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile</CardTitle>
				<CardDescription>
					Edit this account's identity directly. Changes here override the user
					and skip the usual email/verification confirmations.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid gap-2">
					<Label htmlFor="user-name">Name</Label>
					<Input
						id="user-name"
						onChange={(event) => setName(event.target.value)}
						placeholder="Jane Cooper"
						value={name}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="user-email">Email</Label>
					<Input
						id="user-email"
						onChange={(event) => setEmail(event.target.value)}
						placeholder="jane@example.com"
						type="email"
						value={email}
					/>
				</div>
				<div className="flex items-center justify-between gap-4">
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
			</CardContent>
			<CardFooter>
				<Button disabled={!dirty || saving} onClick={save}>
					{saving ? <Loader2 className="animate-spin" /> : null}
					Save changes
				</Button>
			</CardFooter>
		</Card>
	);
}

function DetailsCard({ user }: { user: AdminUserRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Account identifiers and activity.</CardDescription>
			</CardHeader>
			<CardContent>
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
			</CardContent>
		</Card>
	);
}

function AccessCard({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
	const refresh = useRefreshUsers();
	const [role, setRole] = useState<AdminPlatformRole>(user.role);
	const [saving, setSaving] = useState(false);
	const dirty = role !== user.role;

	async function save() {
		setSaving(true);
		try {
			await setAdminUserRole({ data: { userId: user.id, role } });
			await refresh();
			toast.success(
				role === "admin" ? "Granted platform admin." : "Revoked platform admin."
			);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update the role."
			);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Access</CardTitle>
				<CardDescription>
					The platform role. Admins reach this console and manage every
					organization — grant it sparingly.
				</CardDescription>
			</CardHeader>
			{isSelf ? (
				<CardContent>
					<div className="flex items-center gap-2 text-sm">
						<span className="text-muted-foreground">Platform role:</span>
						<Badge variant="secondary">
							{user.role === "admin" ? "Admin" : "User"}
						</Badge>
					</div>
					<p className="mt-2 text-muted-foreground text-sm">
						You can't change your own platform role.
					</p>
				</CardContent>
			) : (
				<>
					<CardContent>
						<div className="grid max-w-xs gap-2">
							<Label htmlFor="user-role">Platform role</Label>
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
						</div>
					</CardContent>
					<CardFooter>
						<Button disabled={!dirty || saving} onClick={save}>
							{saving ? <Loader2 className="animate-spin" /> : null}
							Save role
						</Button>
					</CardFooter>
				</>
			)}
		</Card>
	);
}

function OrganizationsCard({ user }: { user: AdminUserRow }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Organizations</CardTitle>
				<CardDescription>Where this account is a member.</CardDescription>
			</CardHeader>
			<CardContent>
				{user.memberships.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						Not a member of any organization.
					</p>
				) : (
					<ul className="divide-y">
						{user.memberships.map((membership) => (
							<li
								className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
								key={membership.orgId}
							>
								<Link
									className="font-medium text-sm hover:underline"
									params={{ orgId: membership.orgId }}
									to="/admin/orgs/$orgId"
								>
									{membership.orgName}
								</Link>
								<Badge className="capitalize" variant="secondary">
									{membership.role}
								</Badge>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function DangerCard({ user, isSelf }: { user: AdminUserRow; isSelf: boolean }) {
	const refresh = useRefreshUsers();
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const suspended = user.status === "suspended";

	async function toggleStatus() {
		setBusy(true);
		try {
			await setAdminUserStatus({
				data: { userId: user.id, status: suspended ? "active" : "suspended" },
			});
			await refresh();
			toast.success(
				suspended ? `Reactivated “${user.name}”.` : `Suspended “${user.name}”.`
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
			await refresh();
			await navigate({ to: "/admin/users" });
		} catch (error) {
			setBusy(false);
			toast.error(
				error instanceof Error ? error.message : "Couldn't delete the account."
			);
		}
	}

	return (
		<DangerZoneCard description="Account actions apply across the whole platform.">
			<DangerRows>
				{isSelf ? (
					<DangerRow
						action={null}
						description="Manage your own account from your account settings, not here."
						title="This is your account"
					/>
				) : (
					<>
						{suspended ? (
							<DangerRow
								action={
									<Button
										disabled={busy}
										onClick={toggleStatus}
										size="sm"
										variant="outline"
									>
										{busy ? <Loader2 className="animate-spin" /> : null}
										Reactivate
									</Button>
								}
								description="Restore this account's access to the platform."
								title="Reactivate account"
							/>
						) : (
							<DangerRow
								action={
									<Button
										disabled={busy}
										onClick={toggleStatus}
										size="sm"
										variant="outline"
									>
										{busy ? <Loader2 className="animate-spin" /> : null}
										Suspend
									</Button>
								}
								description="Block this account from signing in and end its sessions. Their organizations and servers keep running."
								title="Suspend account"
							/>
						)}
						<DangerRow
							action={
								<Button
									onClick={() => setConfirmOpen(true)}
									size="sm"
									variant="destructive"
								>
									Delete
								</Button>
							}
							description="Permanently remove this account and its memberships. This can't be undone."
							title="Delete account"
						/>
					</>
				)}
			</DangerRows>

			<AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this account?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes “{user.name}” ({user.email}) and removes
							them from every organization. This can't be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel asChild>
							<Button disabled={busy} type="button" variant="outline">
								Cancel
							</Button>
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								disabled={busy}
								onClick={(event) => {
									// Keep the dialog open while the request runs; `remove`
									// closes it on success and leaves it up (with a toast) on
									// failure.
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
		</DangerZoneCard>
	);
}
