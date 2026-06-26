import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Cookie, Loader2, MailCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { AuthDivider, SocialSignIn } from "@/components/auth/social-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { isEmail } from "@/lib/validation";
import { fetchSession, getEnabledSocialProviders } from "@/server/auth/session";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		// Only a same-origin relative path ("/…", not "//…" or a scheme) — so the
		// param can't be used as an open redirect off-site.
		redirect:
			typeof search.redirect === "string" && /^\/(?!\/)/.test(search.redirect)
				? search.redirect
				: undefined,
	}),
	// Already signed in? Don't show the login form — bounce back to where they
	// were headed (or the app root).
	beforeLoad: async ({ search }) => {
		if (await fetchSession()) {
			throw redirect({ href: search.redirect ?? "/" });
		}
	},
	loader: async () => ({ providers: await getEnabledSocialProviders() }),
	component: Login,
});

function Login() {
	const { redirect: redirectTo } = Route.useSearch();
	const { providers } = Route.useLoaderData();
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [sending, setSending] = useState(false);
	const valid = isEmail(email);
	// Where Better Auth returns the user after they follow the magic link.
	const callbackURL = redirectTo ?? "/";

	async function submit(event: FormEvent) {
		event.preventDefault();
		if (!valid || sending) {
			return;
		}
		setSending(true);
		const { error } = await authClient.signIn.magicLink({
			email: email.trim(),
			callbackURL,
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
		<main className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
			<div className="w-full max-w-sm space-y-6">
				<Link
					className="flex items-center justify-center gap-2 font-bold text-base tracking-tight"
					to="/home"
				>
					<Cookie className="size-5 text-primary" strokeWidth={2} />
					Raptor Panel
				</Link>

				<div className="space-y-1.5 text-center">
					<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{"// log in"}
					</div>
					<h1 className="font-bold text-2xl tracking-tight">Welcome back</h1>
					<p className="text-muted-foreground text-sm">
						{providers.length > 0
							? "Continue with a provider, or get a one-time login link by email."
							: "Get a one-time login link by email."}
					</p>
				</div>

				{sent ? (
					<div className="space-y-2 rounded-lg border bg-card p-4 text-center">
						<MailCheck className="mx-auto size-5 text-ok" />
						<p className="font-medium text-sm">Check your inbox</p>
						<p className="text-muted-foreground text-sm">
							A login link is on its way to{" "}
							<span className="font-mono">{email.trim()}</span>.
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
								<SocialSignIn callbackURL={callbackURL} providers={providers} />
								<AuthDivider label="or continue with email" />
							</>
						) : null}
						<form className="space-y-4" onSubmit={submit}>
							<div className="grid gap-2">
								<Label htmlFor="login-email">Email</Label>
								<Input
									autoFocus
									id="login-email"
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
								Email me a link
							</Button>
						</form>
					</div>
				)}

				<p className="text-center text-muted-foreground text-sm">
					New here?{" "}
					<Link className="text-primary hover:underline" to="/onboarding">
						Create an account
					</Link>
				</p>
			</div>
		</main>
	);
}
