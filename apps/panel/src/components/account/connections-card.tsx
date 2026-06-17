import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GitHubIcon, GoogleIcon } from "@/components/auth/provider-icons";
import type { SocialProvider } from "@/components/auth/social-sign-in";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";

// Account OAuth connections, wired to Better Auth account linking. Lists which of
// the configured providers are linked (listAccounts), and links/unlinks via
// linkSocial / unlinkAccount. `providers` is the set with credentials configured
// (from the route loader) — only those can be linked, so only those are shown.
// The caller renders this only when at least one provider is configured.

const PROVIDER_META: Record<
	SocialProvider,
	{ name: string; icon: typeof GoogleIcon }
> = {
	google: { name: "Google", icon: GoogleIcon },
	github: { name: "GitHub", icon: GitHubIcon },
};

async function loadLinkedProviders(): Promise<Set<string>> {
	const { data } = await authClient.listAccounts();
	return new Set((data ?? []).map((account) => account.providerId));
}

export function ConnectionsCard({
	providers,
}: {
	providers: SocialProvider[];
}) {
	// null = still loading the linked set.
	const [linked, setLinked] = useState<Set<string> | null>(null);
	const [busy, setBusy] = useState<SocialProvider | null>(null);

	useEffect(() => {
		let active = true;
		loadLinkedProviders().then((set) => {
			if (active) {
				setLinked(set);
			}
		});
		return () => {
			active = false;
		};
	}, []);

	async function connect(provider: SocialProvider) {
		setBusy(provider);
		// On success Better Auth redirects the browser to the provider and returns
		// to /account, where this remounts and reloads the linked set.
		const { error } = await authClient.linkSocial({
			provider,
			callbackURL: "/account",
		});
		if (error) {
			toast.error(
				error.message ?? `Couldn't connect ${PROVIDER_META[provider].name}.`
			);
			setBusy(null);
		}
	}

	async function disconnect(provider: SocialProvider) {
		setBusy(provider);
		const { error } = await authClient.unlinkAccount({ providerId: provider });
		setBusy(null);
		if (error) {
			// Unlink needs a fresh session (≤1h); surface Better Auth's message.
			toast.error(
				error.message ?? `Couldn't disconnect ${PROVIDER_META[provider].name}.`
			);
			return;
		}
		setLinked(await loadLinkedProviders());
		toast.success(`Disconnected ${PROVIDER_META[provider].name}.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Connections</CardTitle>
				<CardDescription>
					Connect Google or GitHub to log in faster.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="divide-y">
					{providers.map((provider) => {
						const meta = PROVIDER_META[provider];
						const Icon = meta.icon;
						const loading = linked === null;
						const connected = linked?.has(provider) ?? false;
						const working = busy === provider;

						return (
							<div
								className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
								key={provider}
							>
								<div className="flex min-w-0 items-center gap-3">
									<Icon className="size-5 shrink-0" />
									<div className="min-w-0 space-y-0.5">
										<p className="font-medium text-sm">{meta.name}</p>
										{!loading && !connected ? (
											<p className="text-muted-foreground text-xs">
												Not connected
											</p>
										) : null}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									{loading ? (
										// The linked state is fetched — skeleton it until it loads.
										<Skeleton className="h-8 w-24" />
									) : connected ? (
										<>
											<StatusIndicator
												status={{ label: "Connected", tone: "online" }}
											/>
											<Button
												disabled={working}
												onClick={() => disconnect(provider)}
												size="sm"
												variant="outline"
											>
												{working ? <Loader2 className="animate-spin" /> : null}
												Disconnect
											</Button>
										</>
									) : (
										<Button
											disabled={working}
											onClick={() => connect(provider)}
											size="sm"
											variant="outline"
										>
											{working ? <Loader2 className="animate-spin" /> : null}
											Connect
										</Button>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</CardContent>
		</Card>
	);
}
