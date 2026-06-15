import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { AdminList } from "@/components/admin/admin-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { AdminUser } from "@/lib/domain/admin";
import { userStatus } from "@/lib/status";
import { ADMIN_USERS } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/users/")({
	component: AdminUsers,
});

function initials(name: string) {
	return name
		.split(" ")
		.map((part) => part.charAt(0))
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

function orgsLabel(user: AdminUser) {
	const [first, ...rest] = user.memberships;
	if (!first) {
		return "—";
	}
	return rest.length > 0 ? `${first.orgName} +${rest.length}` : first.orgName;
}

function AdminUsers() {
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
				items={ADMIN_USERS}
				row={(user) => (
					<TableRow key={user.id}>
						<TableCell>
							<div className="flex items-center gap-3">
								<Avatar className="size-8">
									<AvatarFallback>{initials(user.name)}</AvatarFallback>
								</Avatar>
								<div className="min-w-0">
									<Link
										className="font-medium hover:underline"
										params={{ userId: user.id }}
										to="/admin/users/$userId"
									>
										{user.name}
									</Link>
									<div className="truncate text-muted-foreground text-xs">
										{user.email}
									</div>
								</div>
							</div>
						</TableCell>
						<TableCell className="text-muted-foreground">
							{orgsLabel(user)}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{user.joinedAt}
						</TableCell>
						<TableCell className="text-right text-muted-foreground tabular-nums">
							{user.lastSeenAt ?? "—"}
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
