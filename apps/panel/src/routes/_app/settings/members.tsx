import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { RemoveButton } from "@/components/shared/remove-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
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
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { isEmail } from "@/lib/validation";

export const Route = createFileRoute("/_app/settings/members")({
	component: SettingsMembers,
});

type ActiveOrg = NonNullable<
	ReturnType<typeof authClient.useActiveOrganization>["data"]
>;
type Member = ActiveOrg["members"][number];
type Invitation = ActiveOrg["invitations"][number];

/** "owner" → "Owner"; tolerates the comma-joined multi-role string. */
function roleLabel(role: string) {
	return role
		.split(",")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(", ");
}

function isManager(role: string | undefined) {
	return !!role && (role.includes("owner") || role.includes("admin"));
}

function SettingsMembers() {
	const { data: org } = authClient.useActiveOrganization();
	const { data: session } = authClient.useSession();

	const members = org?.members ?? [];
	const invitations = (org?.invitations ?? []).filter(
		(invite) => invite.status === "pending"
	);
	const myRole = members.find(
		(member) => member.userId === session?.user.id
	)?.role;
	const canManage = isManager(myRole);

	async function removeMember(member: Member) {
		const label = member.user.name || member.user.email;
		const { error } = await authClient.organization.removeMember({
			memberIdOrEmail: member.id,
		});
		if (error) {
			toast.error(error.message ?? "Couldn't remove the member.");
			return;
		}
		toast.success(`Removed “${label}”.`);
	}

	async function cancelInvitation(invite: Invitation) {
		const { error } = await authClient.organization.cancelInvitation({
			invitationId: invite.id,
		});
		if (error) {
			toast.error(error.message ?? "Couldn't cancel the invitation.");
			return;
		}
		toast.success(`Canceled the invite for ${invite.email}.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Members</CardTitle>
				<CardDescription>
					People who can manage this organization.
				</CardDescription>
				{canManage ? (
					<CardAction>
						<InviteDialog />
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Member</TableHead>
							<TableHead>Role</TableHead>
							<TableHead className="w-0">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{org ? (
							<>
								{members.map((member) => (
									<MemberRow
										canManage={canManage}
										key={member.id}
										member={member}
										onRemove={() => removeMember(member)}
									/>
								))}
								{invitations.map((invite) => (
									<InvitationRow
										canManage={canManage}
										invite={invite}
										key={invite.id}
										onCancel={() => cancelInvitation(invite)}
									/>
								))}
							</>
						) : (
							<LoadingRows />
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function MemberRow({
	member,
	canManage,
	onRemove,
}: {
	member: Member;
	canManage: boolean;
	onRemove: () => void;
}) {
	const label = member.user.name || member.user.email;
	const init = initials(member.user.name) || label.slice(0, 2).toUpperCase();
	const isOwner = member.role.includes("owner");

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<Avatar className="size-8">
						{member.user.image ? (
							<AvatarImage alt="" src={member.user.image} />
						) : null}
						<AvatarFallback>{init}</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<span className="font-medium">{label}</span>
						{member.user.name ? (
							<div className="text-muted-foreground text-sm">
								{member.user.email}
							</div>
						) : null}
					</div>
				</div>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{roleLabel(member.role)}
			</TableCell>
			<TableCell>
				{canManage && !isOwner ? (
					<RemoveButton label={`Remove ${label}`} onClick={onRemove} />
				) : null}
			</TableCell>
		</TableRow>
	);
}

function InvitationRow({
	invite,
	canManage,
	onCancel,
}: {
	invite: Invitation;
	canManage: boolean;
	onCancel: () => void;
}) {
	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<Avatar className="size-8">
						<AvatarFallback>
							{invite.email.slice(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div className="flex min-w-0 items-center gap-2">
						<span className="font-medium">{invite.email}</span>
						<Badge variant="secondary">Pending</Badge>
					</div>
				</div>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{roleLabel(invite.role)}
			</TableCell>
			<TableCell>
				{canManage ? (
					<RemoveButton
						label={`Cancel the invite for ${invite.email}`}
						onClick={onCancel}
					/>
				) : null}
			</TableCell>
		</TableRow>
	);
}

function LoadingRows() {
	return (
		<>
			{[0, 1].map((row) => (
				<TableRow key={row}>
					<TableCell>
						<div className="flex items-center gap-3">
							<Skeleton className="size-8 rounded-full" />
							<Skeleton className="h-4 w-40" />
						</div>
					</TableCell>
					<TableCell>
						<Skeleton className="h-4 w-16" />
					</TableCell>
					<TableCell />
				</TableRow>
			))}
		</>
	);
}

function InviteDialog() {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"member" | "admin">("member");
	const [sending, setSending] = useState(false);

	const valid = isEmail(email.trim());

	function reset() {
		setEmail("");
		setRole("member");
	}

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!valid || sending) {
			return;
		}
		setSending(true);
		const { error } = await authClient.organization.inviteMember({
			email: email.trim(),
			role,
		});
		setSending(false);
		if (error) {
			toast.error(error.message ?? "Couldn't send the invitation.");
			return;
		}
		toast.success("Invitation sent.");
		setOpen(false);
		reset();
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					reset();
				}
			}}
			open={open}
		>
			<DialogTrigger asChild>
				<Button size="sm">Invite member</Button>
			</DialogTrigger>
			<DialogContent>
				<form onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Invite a member</DialogTitle>
						<DialogDescription>
							They'll get an email invitation to join this organization.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="invite-email">Email</Label>
							<Input
								id="invite-email"
								onChange={(event) => setEmail(event.target.value)}
								placeholder="teammate@example.com"
								type="email"
								value={email}
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="invite-role">Role</Label>
							<Select
								onValueChange={(value) => setRole(value as "member" | "admin")}
								value={role}
							>
								<SelectTrigger className="w-full" id="invite-role">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="member">Member</SelectItem>
									<SelectItem value="admin">Admin</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={!valid || sending} type="submit">
							{sending ? <Loader2 className="animate-spin" /> : null}
							Send invite
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
