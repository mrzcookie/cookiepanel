import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useState } from "react";
import { AdminList } from "@/components/admin/admin-list";
import { AdminUserSheet } from "@/components/admin/admin-user-sheet";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { adminUsersQueryOptions } from "@/lib/admin-users-queries";
import type { AdminUserRow } from "@/lib/domain/admin";
import { formatDate, formatRelativeTime, initials } from "@/lib/format";

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
	const [selectedId, setSelectedId] = useState<string | null>(null);

	// Derive the selection from the live list so it stays fresh after a mutation
	// invalidates the cache; a deleted user simply falls out and the sheet closes.
	const selected = users.find((user) => user.id === selectedId) ?? null;

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
					</TableRow>
				}
				icon={Users}
				items={users}
				row={(user) => (
					<TableRow
						className="cursor-pointer"
						key={user.id}
						onClick={() => setSelectedId(user.id)}
					>
						<TableCell>
							<div className="flex items-center gap-3">
								<Avatar className="size-8">
									{user.image ? <AvatarImage alt="" src={user.image} /> : null}
									<AvatarFallback>{initials(user.name)}</AvatarFallback>
								</Avatar>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="font-medium">{user.name}</span>
										{user.role === "admin" ? (
											<Badge variant="secondary">Admin</Badge>
										) : null}
										{user.status === "suspended" ? (
											<Badge variant="destructive">Suspended</Badge>
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
					</TableRow>
				)}
				searchPlaceholder="Search users…"
			/>
			<AdminUserSheet
				onOpenChange={(open) => {
					if (!open) {
						setSelectedId(null);
					}
				}}
				user={selected}
			/>
		</>
	);
}
