import { toast } from "sonner";
import { GitHubIcon, GoogleIcon } from "@/components/auth/provider-icons";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export type SocialProvider = "google" | "github";

const PROVIDERS: {
	id: SocialProvider;
	label: string;
	icon: typeof GoogleIcon;
}[] = [
	{ id: "google", label: "Continue with Google", icon: GoogleIcon },
	{ id: "github", label: "Continue with GitHub", icon: GitHubIcon },
];

// Google + GitHub OAuth. Hands off to the provider via Better Auth, which
// redirects the browser; on success it returns to `callbackURL`. Shared by the
// login and onboarding screens. Pass `providers` to render only the configured
// ones (login does this so dev installs without creds show no dead buttons);
// omit it to show all.
export function SocialSignIn({
	providers,
	callbackURL = "/",
}: {
	providers?: SocialProvider[];
	callbackURL?: string;
}) {
	const shown = PROVIDERS.filter((p) => !providers || providers.includes(p.id));
	if (shown.length === 0) {
		return null;
	}

	async function go(provider: SocialProvider) {
		// On success Better Auth redirects the browser to the provider, so control
		// doesn't return here; an error means the hand-off itself failed.
		const { error } = await authClient.signIn.social({ provider, callbackURL });
		if (error) {
			toast.error(error.message ?? `Couldn't continue with ${provider}.`);
		}
	}

	return (
		<div className="grid gap-2">
			{shown.map((provider) => (
				<Button
					className="w-full"
					key={provider.id}
					onClick={() => go(provider.id)}
					type="button"
					variant="outline"
				>
					<provider.icon />
					{provider.label}
				</Button>
			))}
		</div>
	);
}

export function AuthDivider({ label }: { label: string }) {
	return (
		<div className="flex items-center gap-3">
			<span className="h-px flex-1 bg-border" />
			<span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
				{label}
			</span>
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}
