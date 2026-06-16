import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { AdminUser, AdminUserStatus } from "@/lib/domain/admin";
import { userStatus } from "@/lib/status";
import { ADMIN_USERS } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/users/$userId")({
	component: AdminUserDetail,
});

function AdminUserDetail() {
	const { userId } = Route.useParams();
	const user = ADMIN_USERS.find((candidate) => candidate.id === userId);

	if (!user) {
		return (
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
		);
	}

	return <UserView user={user} />;
}

function UserView({ user }: { user: AdminUser }) {
	const navigate = useNavigate();
	// Local so Suspend / Reactivate visibly toggles in the UI-first phase.
	const [status, setStatus] = useState<AdminUserStatus>(user.status);

	function remove() {
		toast.success(`Deleted “${user.name}”.`);
		navigate({ to: "/admin/users" });
	}

	return (
		<>
			<PageHeader
				actions={<StatusIndicator status={userStatus(status)} />}
				back={{ label: "Users", to: "/admin/users" }}
				description={user.email}
				title={user.name}
			/>

			<div className="max-w-2xl space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>Profile</CardTitle>
						<CardDescription>Account details.</CardDescription>
					</CardHeader>
					<CardContent>
						<DetailList>
							<DetailRow copyable label="User ID" value={user.id} />
							<DetailRow copyable label="Email" value={user.email} />
							<DetailRow label="Status" value={userStatus(status).label} />
							<DetailRow label="Joined" value={user.joinedAt} />
							<DetailRow label="Last seen" value={user.lastSeenAt ?? "—"} />
						</DetailList>
					</CardContent>
				</Card>

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

				<DangerZoneCard description="Account actions apply across the whole platform.">
					<DangerRows>
						{status === "suspended" ? (
							<DangerRow
								action={
									<Button
										onClick={() => {
											setStatus("active");
											toast.success(`Reactivated “${user.name}”.`);
										}}
										size="sm"
										variant="outline"
									>
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
										onClick={() => {
											setStatus("suspended");
											toast.success(`Suspended “${user.name}”.`);
										}}
										size="sm"
										variant="outline"
									>
										Suspend
									</Button>
								}
								description="Block this account from signing in. Their organizations and servers keep running."
								title="Suspend account"
							/>
						)}
						<DangerRow
							action={
								<Button onClick={remove} size="sm" variant="destructive">
									Delete
								</Button>
							}
							description="Permanently remove this account. This can't be undone."
							title="Delete account"
						/>
					</DangerRows>
				</DangerZoneCard>
			</div>
		</>
	);
}
