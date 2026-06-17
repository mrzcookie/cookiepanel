import { createFileRoute, Link } from "@tanstack/react-router";
import { Cookie } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AuthDivider, SocialSignIn } from "@/components/auth/social-sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isEmail } from "@/lib/validation";
import { getEnabledSocialProviders } from "@/server/auth/session";

export const Route = createFileRoute("/onboarding")({
	loader: async () => ({ providers: await getEnabledSocialProviders() }),
	component: Onboarding,
});

function Onboarding() {
	const { providers } = Route.useLoaderData();
	const navigate = Route.useNavigate();
	const [email, setEmail] = useState("");
	const [org, setOrg] = useState("");
	const valid = isEmail(email) && org.trim() !== "";

	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
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
						{"// get started"}
					</div>
					<h1 className="font-bold text-2xl tracking-tight">
						Create your account
					</h1>
					<p className="text-muted-foreground text-sm">
						{providers.length > 0
							? "Continue with a provider, or use your email and a name for your first organization."
							: "Use your email and a name for your first organization."}
					</p>
				</div>

				{providers.length > 0 ? (
					<>
						<SocialSignIn providers={providers} />
						<AuthDivider label="or continue with email" />
					</>
				) : null}

				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!valid) {
							return;
						}
						toast.success(`Welcome to ${org.trim()}.`);
						navigate({ to: "/" });
					}}
				>
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
					<div className="grid gap-2">
						<Label htmlFor="onboard-org">Organization name</Label>
						<Input
							id="onboard-org"
							onChange={(event) => setOrg(event.target.value)}
							placeholder="Acme Gaming"
							value={org}
						/>
					</div>
					<Button className="w-full" disabled={!valid} type="submit">
						Create account
					</Button>
				</form>

				<p className="text-center text-muted-foreground text-sm">
					Already have an account?{" "}
					<Link className="text-primary hover:underline" to="/login">
						Log in
					</Link>
				</p>
			</div>
		</main>
	);
}
