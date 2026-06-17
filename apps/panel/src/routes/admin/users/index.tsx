import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { adminUsersQueryOptions } from "@/lib/admin-users-queries";
import type { AdminUserRow } from "@/lib/domain/admin";
import { formatDate, formatRelativeTime, initials } from "@/lib/format";
import { userStatus } from "@/lib/status";

export const Route = createFileRoute("/admin/users/")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(adminUsersQueryOptions()),
	component: AdminUsers,
});

function orgsLabel(user: AdminUserRow) {
	const [first, ...rest] = user.memberships;
	if (!first) {
		return "—";
	}
	return rest.length > 0 ? `${first.orgName} +${rest.length}` : first.orgName;
}

function AdminUsers() {
	const { data: users } = useSuspenseQuery(adminUsersQueryOptions());

	return (
		<>
			<PageHeader
				description="Every account on the platform — search, inspect memberships, and manage access."
				eyebrow="accounts"
				title="Users"
			/>
			<AdminList
				emptyDescription="No accounts yet."
				emptyTitle="No users"
				filter={(user, q) =>
					user.name.toLowerCase().includes(q) ||
					user.email.toLowerCase().includes(q) ||
					user.memberships.some((m) => m.orgName.toLowerCase().includes(q))
				}
				head={
					<TableRow>
						<TableHead>User</TableHead>
						<TableHead>Organizations</TableHead>
						<TableHead className="text-right">Joined</TableHead>
						<TableHead className="text-right">Last seen</TableHead>
						<TableHead className="text-right">Status</TableHead>
					</TableRow>
				}
				icon={Users}
				items={users}
				row={(user) => (
					<TableRow key={user.id}>
						<TableCell>
							<div className="flex items-center gap-3">
								<Avatar className="size-8">
									{user.image ? <AvatarImage alt="" src={user.image} /> : null}
									<AvatarFallback>{initials(user.name)}</AvatarFallback>
								</Avatar>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<Link
											className="font-medium hover:underline"
											params={{ userId: user.id }}
											to="/admin/users/$userId"
										>
											{user.name}
										</Link>
										{user.role === "admin" ? (
											<Badge variant="secondary">Admin</Badge>
										) : null}
									</div>
									<div className="truncate text-muted-foreground text-xs">
										{user.email}
									</div>
								</div>
							</div>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{orgsLabel(user)}
						</TableCell>
						<TableCell
							className="text-right text-muted-foreground tabular-nums"
							suppressHydrationWarning
						>
							{formatDate(user.createdAt)}
						</TableCell>
						<TableCell
							className="text-right text-muted-foreground tabular-nums"
							suppressHydrationWarning
						>
							{user.lastSeenAt ? formatRelativeTime(user.lastSeenAt) : "—"}
						</TableCell>
						<TableCell className="text-right">
							<StatusIndicator status={userStatus(user.status)} />
						</TableCell>
					</TableRow>
				)}
				searchPlaceholder="Search users…"
			/>
		</>
	);
}
