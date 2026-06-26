import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Boxes,
	Cookie,
	FolderTree,
	Gauge,
	type LucideIcon,
	ShieldCheck,
} from "lucide-react";
import { CopyButton } from "@/components/shared/detail-list";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/home")({
	component: Landing,
});

const INSTALL = "curl -sSL https://get.raptorpanel.app | sh";

const FEATURES: {
	icon: LucideIcon;
	label: string;
	title: string;
	body: string;
}[] = [
	{
		icon: Boxes,
		label: "deploy",
		title: "Eggs, not images",
		body: "Pick a Egg and fill in a few friendly fields. Raw Docker image strings stay hidden.",
	},
	{
		icon: Gauge,
		label: "observe",
		title: "Live at a glance",
		body: "CPU, memory, and disk per server and per box, with a console you can actually read.",
	},
	{
		icon: FolderTree,
		label: "operate",
		title: "Everything in one place",
		body: "Files, ports, networks, firewall, schedules, and backups, without touching a terminal.",
	},
];

function Landing() {
	return (
		<div className="flex min-h-svh flex-col bg-background text-foreground">
			<header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
				<span className="flex items-center gap-2">
					<Cookie className="size-5 text-primary" strokeWidth={2} />
					<span className="font-bold text-base tracking-tight">
						RaptorPanel
					</span>
				</span>
				<nav className="flex items-center gap-2">
					<Button asChild size="sm" variant="ghost">
						<Link to="/login">Log in</Link>
					</Button>
					<Button asChild size="sm">
						<Link to="/onboarding">Get started</Link>
					</Button>
				</nav>
			</header>

			<main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-16 px-6 py-20">
				<section className="max-w-2xl space-y-6">
					<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{"// self-hosted game-server control"}
					</div>
					<h1 className="text-balance font-bold text-5xl leading-[1.05] tracking-tight">
						Run game servers on hardware you own.{" "}
						<span className="text-primary">No terminal required.</span>
					</h1>
					<p className="max-w-xl text-balance text-base text-muted-foreground">
						Connect a Linux box and RaptorPanel turns it into a managed fleet:
						spin up a Minecraft or any server from a Egg, then handle files,
						ports, schedules, and backups from one calm control surface.
					</p>
					<div className="flex flex-wrap items-center gap-3 pt-1">
						<Button asChild>
							<Link to="/onboarding">Get started</Link>
						</Button>
						<Button asChild variant="outline">
							<Link to="/login">Log in</Link>
						</Button>
					</div>
				</section>

				<section className="space-y-3">
					<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						{"// connect a box"}
					</div>
					<div className="terminal flex items-center gap-3 rounded-lg px-4 py-3">
						<span className="font-mono text-ok text-sm">$</span>
						<code className="min-w-0 flex-1 truncate font-mono text-sm">
							{INSTALL}
						</code>
						<CopyButton label="install command" value={INSTALL} />
					</div>
				</section>

				<section className="grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 sm:grid-cols-3">
					{FEATURES.map((feature) => (
						<Feature feature={feature} key={feature.title} />
					))}
				</section>
			</main>

			<footer className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 text-muted-foreground text-xs">
				<span className="flex items-center gap-1.5 font-mono uppercase tracking-wider">
					<ShieldCheck className="size-3.5" />
					Secure by default
				</span>
				<span>© RaptorPanel</span>
			</footer>
		</div>
	);
}

function Feature({
	feature,
}: {
	feature: { icon: LucideIcon; label: string; title: string; body: string };
}) {
	const Icon = feature.icon;
	return (
		<div className="space-y-2 bg-card p-6">
			<Icon className="size-5 text-primary" strokeWidth={1.75} />
			<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
				{feature.label}
			</div>
			<h2 className="font-medium text-base">{feature.title}</h2>
			<p className="text-muted-foreground text-sm">{feature.body}</p>
		</div>
	);
}
