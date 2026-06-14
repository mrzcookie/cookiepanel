import { createFileRoute, Link } from "@tanstack/react-router";
import { Cookie, MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AuthDivider, SocialSignIn } from "@/components/social-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
	component: Login,
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function Login() {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const valid = EMAIL.test(email.trim());

	return (
		<div className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
			<div className="w-full max-w-sm space-y-6">
				<Link
					className="flex items-center justify-center gap-2 font-bold text-base tracking-tight"
					to="/home"
				>
					<Cookie className="size-5 text-primary" strokeWidth={2} />
					CookiePanel
				</Link>

				<div className="space-y-1.5 text-center">
					<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{"// log in"}
					</div>
					<h1 className="font-bold text-2xl tracking-tight">Welcome back</h1>
					<p className="text-muted-foreground text-sm">
						Continue with a provider, or get a one-time login link by email.
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
						<SocialSignIn />
						<AuthDivider label="or continue with email" />
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								if (!valid) {
									return;
								}
								setSent(true);
								toast.success("Login link sent.");
							}}
						>
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
							<Button className="w-full" disabled={!valid} type="submit">
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
		</div>
	);
}
