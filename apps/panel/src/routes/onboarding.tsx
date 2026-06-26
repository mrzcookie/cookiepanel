import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { Cookie, Loader2, MailCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AuthDivider,
	type SocialProvider,
	SocialSignIn,
} from "@/components/auth/social-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { createOrganization, nextOrgDestination } from "@/lib/org";
import { isEmail } from "@/lib/validation";
import { fetchSession, getEnabledSocialProviders } from "@/server/auth/session";

export const Route = createFileRoute("/onboarding")({
	// Onboarding is for users without an organization yet: signed out (create an
	// account) or signed in with no active org (create the first one). Anyone
	// already set up is sent into the app.
	beforeLoad: async () => {
		const session = await fetchSession();
		if (session?.activeOrganizationId) {
			throw redirect({ to: "/" });
		}
		return { signedIn: !!session };
	},
	loader: async () => ({ providers: await getEnabledSocialProviders() }),
	component: Onboarding,
});

function Onboarding() {
	const { signedIn } = Route.useRouteContext();
	const { providers } = Route.useLoaderData();

	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
			<div className="w-full max-w-sm space-y-6">
				<Link
					className="flex items-center justify-center gap-2 font-bold text-base tracking-tight"
					to="/home"
				>
					<Cookie className="size-5 text-primary" strokeWidth={2} />
					RaptorPanel
				</Link>

				{signedIn ? (
					<CreateFirstOrg />
				) : (
					<CreateAccount providers={providers} />
				)}
			</div>
		</main>
	);
}

/** Signed-out step: email → magic link. The org is created after login. */
function CreateAccount({ providers }: { providers: SocialProvider[] }) {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [sending, setSending] = useState(false);
	const valid = isEmail(email);

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!valid || sending) {
			return;
		}
		setSending(true);
		const { error } = await authClient.signIn.magicLink({
			email: email.trim(),
			callbackURL: "/onboarding",
		});
		setSending(false);
		if (error) {
			toast.error(error.message ?? "Couldn't send the login link.");
			return;
		}
		setSent(true);
		toast.success("Login link sent.");
	}

	return (
		<>
			<div className="space-y-1.5 text-center">
				<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{"// get started"}
				</div>
				<h1 className="font-bold text-2xl tracking-tight">
					Create your account
				</h1>
				<p className="text-muted-foreground text-sm">
					{providers.length > 0
						? "Continue with a provider, or use your email to get started."
						: "Use your email to get started."}
				</p>
			</div>

			{sent ? (
				<div className="space-y-2 rounded-lg border bg-card p-4 text-center">
					<MailCheck className="mx-auto size-5 text-ok" />
					<p className="font-medium text-sm">Check your inbox</p>
					<p className="text-muted-foreground text-sm">
						A login link is on its way to{" "}
						<span className="font-mono">{email.trim()}</span>. Open it to finish
						setting up your account.
					</p>
					<Button
						className="mt-1"
						onClick={() => setSent(false)}
						size="sm"
						variant="ghost"
					>
						Use a different email
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					{providers.length > 0 ? (
						<>
							<SocialSignIn callbackURL="/onboarding" providers={providers} />
							<AuthDivider label="or continue with email" />
						</>
					) : null}
					<form className="space-y-4" onSubmit={submit}>
						<div className="grid gap-2">
							<Label htmlFor="onboard-email">Email</Label>
							<Input
								id="onboard-email"
								onChange={(event) => setEmail(event.target.value)}
								placeholder="you@example.com"
								type="email"
								value={email}
							/>
						</div>
						<Button
							className="w-full"
							disabled={!valid || sending}
							type="submit"
						>
							{sending ? <Loader2 className="animate-spin" /> : null}
							Create account
						</Button>
					</form>
				</div>
			)}

			<p className="text-center text-muted-foreground text-sm">
				Already have an account?{" "}
				<Link className="text-primary hover:underline" to="/login">
					Log in
				</Link>
			</p>
		</>
	);
}

/** Signed-in step: name and create the first organization. */
function CreateFirstOrg() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);

	// We land here whenever the session has no valid active org — which includes a
	// member whose active org was just deleted/left but who still belongs to
	// another. Recover into that one rather than making them create a new org; a
	// genuinely org-less user has nothing to switch to and stays on the form.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const dest = await nextOrgDestination();
			if (cancelled || dest !== "/") {
				return;
			}
			queryClient.clear();
			await navigate({ to: "/" });
		})();
		return () => {
			cancelled = true;
		};
	}, [navigate, queryClient]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === "" || creating) {
			return;
		}
		setCreating(true);
		const { error } = await createOrganization(trimmed);
		if (error) {
			setCreating(false);
			toast.error(error.message ?? "Couldn't create your organization.");
			return;
		}
		// New org is active now; clear any stale caches and head into the app.
		queryClient.clear();
		await navigate({ to: "/" });
	}

	return (
		<>
			<div className="space-y-1.5 text-center">
				<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{"// one more step"}
				</div>
				<h1 className="font-bold text-2xl tracking-tight">
					Name your organization
				</h1>
				<p className="text-muted-foreground text-sm">
					A workspace for your nodes, servers, and eggs. You can rename it or
					add more later.
				</p>
			</div>

			<form className="space-y-4" onSubmit={submit}>
				<div className="grid gap-2">
					<Label htmlFor="first-org">Organization name</Label>
					<Input
						autoFocus
						id="first-org"
						onChange={(event) => setName(event.target.value)}
						placeholder="Acme Gaming"
						value={name}
					/>
				</div>
				<Button
					className="w-full"
					disabled={name.trim() === "" || creating}
					type="submit"
				>
					{creating ? <Loader2 className="animate-spin" /> : null}
					Create organization
				</Button>
			</form>
		</>
	);
}
