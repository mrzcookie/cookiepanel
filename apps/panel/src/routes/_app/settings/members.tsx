import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { RemoveButton } from "@/components/shared/remove-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { CURRENT_USER } from "@/lib/stubs";

export const Route = createFileRoute("/_app/settings/members")({
	component: SettingsMembers,
});

type Member = {
	id: string;
	name: string | null;
	email: string;
	role: string;
	pending?: boolean;
};

const INITIAL_MEMBERS: Member[] = [
	{
		id: "m_1",
		name: CURRENT_USER.name,
		email: CURRENT_USER.email,
		role: "Owner",
	},
	{ id: "m_2", name: "Marco Diaz", email: "marco@example.com", role: "Admin" },
];

function initials(text: string) {
	return text.slice(0, 2).toUpperCase();
}

function SettingsMembers() {
	const [members, setMembers] = useState<Member[]>(INITIAL_MEMBERS);
	const [open, setOpen] = useState(false);

	const form = useForm({
		defaultValues: { email: "", role: "Member" },
		onSubmit: ({ value, formApi }) => {
			setMembers((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					name: null,
					email: value.email.trim(),
					role: value.role,
					pending: true,
				},
			]);
			toast.success("Invitation sent.");
			setOpen(false);
			formApi.reset();
		},
	});

	function remove(id: string, name: string) {
		setMembers((prev) => prev.filter((member) => member.id !== id));
		toast.success(`Removed “${name}”.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Members</CardTitle>
				<CardDescription>
					People who can manage this organization.
				</CardDescription>
				<CardAction>
					<Dialog
						onOpenChange={(next) => {
							setOpen(next);
							if (!next) {
								form.reset();
							}
						}}
						open={open}
					>
						<DialogTrigger asChild>
							<Button size="sm">Invite member</Button>
						</DialogTrigger>
						<DialogContent>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									form.handleSubmit();
								}}
							>
								<DialogHeader>
									<DialogTitle>Invite a member</DialogTitle>
									<DialogDescription>
										They'll get an email invitation to join this organization.
									</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<form.Field name="email">
										{(field) => (
											<div className="grid gap-2">
												<Label htmlFor={field.name}>Email</Label>
												<Input
													id={field.name}
													name={field.name}
													onBlur={field.handleBlur}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder="teammate@example.com"
													type="email"
													value={field.state.value}
												/>
											</div>
										)}
									</form.Field>
									<form.Field name="role">
										{(field) => (
											<div className="grid gap-2">
												<Label htmlFor={field.name}>Role</Label>
												<Select
													onValueChange={(value) => field.handleChange(value)}
													value={field.state.value}
												>
													<SelectTrigger className="w-full" id={field.name}>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="Member">Member</SelectItem>
														<SelectItem value="Admin">Admin</SelectItem>
													</SelectContent>
												</Select>
											</div>
										)}
									</form.Field>
								</div>
								<DialogFooter>
									<DialogClose asChild>
										<Button type="button" variant="outline">
											Cancel
										</Button>
									</DialogClose>
									<form.Subscribe
										selector={(state) => state.values.email.trim() !== ""}
									>
										{(canInvite) => (
											<Button disabled={!canInvite} type="submit">
												Send invite
											</Button>
										)}
									</form.Subscribe>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</CardAction>
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
						{members.map((member) => (
							<TableRow key={member.id}>
								<TableCell>
									<div className="flex items-center gap-3">
										<Avatar className="size-8">
											<AvatarFallback>
												{initials(member.name ?? member.email)}
											</AvatarFallback>
										</Avatar>
										<div className="min-w-0">
											<div className="flex items-center gap-2">
												<span className="font-medium">
													{member.name ?? member.email}
												</span>
												{member.pending ? (
													<Badge variant="secondary">Pending</Badge>
												) : null}
											</div>
											{member.name ? (
												<div className="text-muted-foreground text-sm">
													{member.email}
												</div>
											) : null}
										</div>
									</div>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{member.role}
								</TableCell>
								<TableCell>
									{member.role === "Owner" ? null : (
										<RemoveButton
											label={`Remove ${member.name ?? member.email}`}
											onClick={() =>
												remove(member.id, member.name ?? member.email)
											}
										/>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
