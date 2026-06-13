import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { GitHubIcon, GoogleIcon } from "@/components/provider-icons";
import { Button } from "@/components/ui/button";

// Google + GitHub OAuth. A real impl hands off to the provider; the stub toasts
// and drops you into the app. Shared by the login and onboarding screens.
export function SocialSignIn() {
	const navigate = useNavigate();

	function go(provider: string) {
		toast.success(`Continuing with ${provider}…`);
		navigate({ to: "/" });
	}

	return (
		<div className="grid gap-2">
			<Button
				className="w-full"
				onClick={() => go("Google")}
				type="button"
				variant="outline"
			>
				<GoogleIcon />
				Continue with Google
			</Button>
			<Button
				className="w-full"
				onClick={() => go("GitHub")}
				type="button"
				variant="outline"
			>
				<GitHubIcon />
				Continue with GitHub
			</Button>
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
