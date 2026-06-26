import { createFileRoute } from "@tanstack/react-router";
import { Loader2, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConnectionsCard } from "@/components/account/connections-card";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
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
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { formatDate, initials } from "@/lib/format";
import { isEmail } from "@/lib/validation";
import { getEnabledSocialProviders } from "@/server/auth/session";
import { removeAvatar, uploadAvatar } from "@/server/user";

export const Route = createFileRoute("/_app/account/")({
	loader: async () => ({ socialProviders: await getEnabledSocialProviders() }),
	component: AccountGeneral,
});

/** The signed-in user as the auth client reports it (includes the custom theme). */
type SessionUser = NonNullable<
	ReturnType<typeof authClient.useSession>["data"]
>["user"];

function AccountGeneral() {
	const { socialProviders } = Route.useLoaderData();
	const { data: session } = authClient.useSession();
	// The _app guard guarantees a session; while the client session is still
	// loading, `user` is undefined and the data-bearing cards render skeletons —
	// so the whole page layout is visible immediately, not a single loading card.
	const user = session?.user;

	return (
		<div className="max-w-2xl space-y-6">
			<ProfileCard user={user} />
			<AppearanceCard />
			{socialProviders.length > 0 ? (
				<ConnectionsCard providers={socialProviders} />
			) : null}
			<DetailsCard user={user} />
			<DeleteAccountCard />
		</div>
	);
}

function ProfileCard({ user }: { user: SessionUser | undefined }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Profile</CardTitle>
				<CardDescription>Your name, email, and avatar.</CardDescription>
			</CardHeader>
			{/* Keyed so the form remounts when the session resolves — the name
			    field then initializes from the loaded value. */}
			<ProfileFormBody key={user?.id ?? "loading"} user={user} />
		</Card>
	);
}

function ProfileFormBody({ user }: { user: SessionUser | undefined }) {
	const { refetch } = authClient.useSession();
	const [name, setName] = useState(user?.name ?? "");
	const [savingName, setSavingName] = useState(false);

	const trimmed = name.trim();
	const nameDirty = !!user && trimmed.length > 0 && trimmed !== user.name;
	// Initials of the saved name (not the in-progress edit) — the avatar's
	// no-image fallback, matching the account menu.
	const init = initials(user?.name);

	async function handleAvatarUpload(file: File) {
		const body = new FormData();
		body.append("file", file);
		try {
			await uploadAvatar({ data: body });
			await refetch();
			toast.success("Avatar updated.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't update your avatar."
			);
		}
	}

	async function handleAvatarRemove() {
		try {
			await removeAvatar();
			await refetch();
			toast.success("Avatar removed.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't remove your avatar."
			);
		}
	}

	async function saveName() {
		setSavingName(true);
		const { error } = await authClient.updateUser({ name: trimmed });
		setSavingName(false);
		if (error) {
			toast.error(error.message ?? "Couldn't save your name.");
			return;
		}
		await refetch();
		toast.success("Profile saved.");
	}

	return (
		<>
			<CardContent className="space-y-6">
				{/* Only the avatar image is fetched — the button + hint render now. */}
				<ImageUploadField
					fallback={
						init ? (
							<span className="font-medium text-xl">{init}</span>
						) : undefined
					}
					icon={UserRound}
					label="Upload avatar"
					loading={!user}
					onRemove={handleAvatarRemove}
					onUpload={handleAvatarUpload}
					shape="circle"
					value={user?.image ?? null}
				/>
				<div className="grid gap-2">
					<Label htmlFor="account-name">Name</Label>
					{user ? (
						<Input
							id="account-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Your name"
							value={name}
						/>
					) : (
						<Skeleton className="h-9 w-full" />
					)}
				</div>
				<EmailField user={user} />
			</CardContent>
			<CardFooter>
				<Button disabled={!nameDirty || savingName} onClick={saveName}>
					{savingName ? <Loader2 className="animate-spin" /> : null}
					Save changes
				</Button>
			</CardFooter>
		</>
	);
}

function EmailField({ user }: { user: SessionUser | undefined }) {
	return (
		<div className="grid gap-2">
			<Label>Email</Label>
			<div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
				{user ? (
					<span className="truncate font-mono text-sm">{user.email}</span>
				) : (
					<Skeleton className="h-4 w-48" />
				)}
				{user ? (
					<ChangeEmailDialog currentEmail={user.email} />
				) : (
					<Button disabled size="sm" variant="outline">
						Change
					</Button>
				)}
			</div>
			<p className="text-muted-foreground text-xs">
				Changing your email needs confirmation from your current address.
			</p>
		</div>
	);
}

function ChangeEmailDialog({ currentEmail }: { currentEmail: string }) {
	const [open, setOpen] = useState(false);
	const [newEmail, setNewEmail] = useState("");
	const [sending, setSending] = useState(false);

	const trimmed = newEmail.trim();
	const valid =
		isEmail(trimmed) && trimmed.toLowerCase() !== currentEmail.toLowerCase();

	async function submit() {
		setSending(true);
		// Verified (magic-link) users get a confirmation link at their CURRENT
		// address; the email only changes once they follow it.
		const { error } = await authClient.changeEmail({
			newEmail: trimmed,
			callbackURL: "/account",
		});
		setSending(false);
		if (error) {
			toast.error(error.message ?? "Couldn't start the email change.");
			return;
		}
		setOpen(false);
		setNewEmail("");
		toast.success("Check your current inbox to confirm the change.");
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setNewEmail("");
				}
			}}
			open={open}
		>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					Change
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Change your email</DialogTitle>
					<DialogDescription>
						We'll send a confirmation link to your current address (
						{currentEmail}). Your email changes only after you follow it.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2">
					<Label htmlFor="new-email">New email</Label>
					<Input
						autoFocus
						id="new-email"
						onChange={(event) => setNewEmail(event.target.value)}
						placeholder="you@example.com"
						type="email"
						value={newEmail}
					/>
				</div>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cancel
						</Button>
					</DialogClose>
					<Button disabled={!valid || sending} onClick={submit}>
						{sending ? <Loader2 className="animate-spin" /> : null}
						Send confirmation
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AppearanceCard() {
	async function persistTheme(theme: string) {
		// Save to the account so the preference follows the user across devices
		// (applied on load by AccountThemeSync). next-themes already applied it
		// locally; this just persists the choice.
		const { error } = await authClient.updateUser({ theme });
		if (error) {
			toast.error("Couldn't save your theme preference.");
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Appearance</CardTitle>
				<CardDescription>
					Choose how RaptorPanel looks to you. Your choice is saved to your
					account.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ThemeSwitcher onChange={persistTheme} />
			</CardContent>
		</Card>
	);
}

function DetailsCard({ user }: { user: SessionUser | undefined }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Details</CardTitle>
				<CardDescription>Identifiers for your account.</CardDescription>
			</CardHeader>
			<CardContent>
				<DetailList>
					<DetailRow copyable label="Account ID" value={user?.id} />
					<DetailRow
						label="Member since"
						value={user ? formatDate(user.createdAt) : undefined}
					/>
				</DetailList>
			</CardContent>
		</Card>
	);
}

function DeleteAccountCard() {
	const [open, setOpen] = useState(false);
	const [sending, setSending] = useState(false);

	async function requestDeletion() {
		setSending(true);
		// Deletion is confirmed by email — Better Auth sends a link; the account is
		// removed (and the session ended) only when it's followed.
		const { error } = await authClient.deleteUser({ callbackURL: "/login" });
		setSending(false);
		if (error) {
			toast.error(error.message ?? "Couldn't start account deletion.");
			return;
		}
		setOpen(false);
		toast.success("Check your email to confirm deletion.");
	}

	return (
		<Card className="border-destructive/40">
			<CardHeader>
				<CardTitle className="text-destructive">Delete account</CardTitle>
				<CardDescription>
					Permanently delete your account and remove you from every
					organization. Organizations you solely own must be deleted or
					transferred first. This can't be undone.
				</CardDescription>
			</CardHeader>
			<CardFooter>
				<Button onClick={() => setOpen(true)} variant="destructive">
					Delete account
				</Button>
			</CardFooter>

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete your account?</DialogTitle>
						<DialogDescription>
							We'll email a confirmation link to your address. Following it
							permanently deletes your account and removes you from every
							organization. This can't be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button
							disabled={sending}
							onClick={requestDeletion}
							variant="destructive"
						>
							{sending ? <Loader2 className="animate-spin" /> : null}
							Email me the link
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	);
}
