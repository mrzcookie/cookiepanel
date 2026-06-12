import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { RemoveButton } from "@/components/remove-button";
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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_app/account/ssh-keys")({
	component: AccountSshKeys,
});

type SshKey = {
	id: string;
	name: string;
	fingerprint: string;
	addedAt: string;
};

const INITIAL_KEYS: SshKey[] = [
	{
		id: "key_1",
		name: "MacBook Pro",
		fingerprint: "SHA256:9pZkq3…rT8e2F",
		addedAt: "May 3, 2026",
	},
];

// Stub fingerprint for the UI-first phase (no crypto yet).
function fingerprintOf(publicKey: string) {
	try {
		const hash = btoa(publicKey.trim()).replace(/[^a-zA-Z0-9]/g, "");
		return `SHA256:${hash.slice(0, 12)}…${hash.slice(-6)}`;
	} catch {
		return "SHA256:…";
	}
}

function AccountSshKeys() {
	const [keys, setKeys] = useState<SshKey[]>(INITIAL_KEYS);
	const [open, setOpen] = useState(false);

	const form = useForm({
		defaultValues: { name: "", publicKey: "" },
		onSubmit: ({ value, formApi }) => {
			setKeys((prev) => [
				...prev,
				{
					id: crypto.randomUUID(),
					name: value.name.trim(),
					fingerprint: fingerprintOf(value.publicKey),
					addedAt: "Just now",
				},
			]);
			toast.success("SSH key added.");
			setOpen(false);
			formApi.reset();
		},
	});

	function remove(id: string, name: string) {
		setKeys((prev) => prev.filter((key) => key.id !== id));
		toast.success(`Removed “${name}”.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>SSH keys</CardTitle>
				<CardDescription>
					Public keys for SFTP access to your servers' files.
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
							<Button size="sm">Add SSH key</Button>
						</DialogTrigger>
						<DialogContent>
							<form
								onSubmit={(event) => {
									event.preventDefault();
									form.handleSubmit();
								}}
							>
								<DialogHeader>
									<DialogTitle>Add an SSH key</DialogTitle>
									<DialogDescription>
										Paste a public key to allow SFTP access to your servers.
									</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<form.Field name="name">
										{(field) => (
											<div className="grid gap-2">
												<Label htmlFor={field.name}>Name</Label>
												<Input
													id={field.name}
													name={field.name}
													onBlur={field.handleBlur}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder="MacBook Pro"
													value={field.state.value}
												/>
											</div>
										)}
									</form.Field>
									<form.Field name="publicKey">
										{(field) => (
											<div className="grid gap-2">
												<Label htmlFor={field.name}>Public key</Label>
												<Textarea
													className="font-mono text-xs"
													id={field.name}
													name={field.name}
													onBlur={field.handleBlur}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder="ssh-ed25519 AAAA…"
													rows={4}
													value={field.state.value}
												/>
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
										selector={(state) =>
											state.values.name.trim() !== "" &&
											state.values.publicKey.trim() !== ""
										}
									>
										{(canAdd) => (
											<Button disabled={!canAdd} type="submit">
												Add key
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
				{keys.length === 0 ? (
					<EmptyState
						description="Add a public key to access your servers' files over SFTP."
						icon={KeyRound}
						title="No SSH keys yet"
					/>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Fingerprint</TableHead>
								<TableHead>Added</TableHead>
								<TableHead className="w-0">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.map((key) => (
								<TableRow key={key.id}>
									<TableCell className="font-medium">{key.name}</TableCell>
									<TableCell className="font-mono text-muted-foreground text-xs">
										{key.fingerprint}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{key.addedAt}
									</TableCell>
									<TableCell>
										<RemoveButton
											label={`Remove ${key.name}`}
											onClick={() => remove(key.id, key.name)}
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
