import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/admin/settings")({
	component: AdminSettings,
});

function AdminSettings() {
	return (
		<>
			<PageHeader
				description="Global feature flags for Raptor itself."
				eyebrow="system"
				title="Settings"
			/>
			<div className="max-w-2xl">
				<FeatureFlagsCard />
			</div>
		</>
	);
}

type Flag = {
	key: string;
	label: string;
	description: string;
	enabled: boolean;
};

const FLAGS: Flag[] = [
	{
		key: "open-signups",
		label: "Open sign-ups",
		description: "Let anyone create an account without an invitation.",
		enabled: true,
	},
	{
		key: "managed-subdomains",
		label: "Managed subdomains",
		description: "Offer panel-minted subdomains and DNS for new nodes.",
		enabled: true,
	},
	{
		key: "egg-imports",
		label: "Egg imports",
		description: "Allow organizations to import eggs from a URL or file.",
		enabled: true,
	},
	{
		key: "database-browser",
		label: "Database browser add-on",
		description: "Expose the in-panel database browser on database servers.",
		enabled: false,
	},
	{
		key: "maintenance-mode",
		label: "Maintenance mode",
		description: "Show a maintenance banner and pause new deployments.",
		enabled: false,
	},
];

function FeatureFlagsCard() {
	const [flags, setFlags] = useState<Record<string, boolean>>(() =>
		Object.fromEntries(FLAGS.map((flag) => [flag.key, flag.enabled]))
	);

	function toggle(key: string, label: string) {
		const next = !flags[key];
		setFlags({ ...flags, [key]: next });
		toast.success(`${label} ${next ? "enabled" : "disabled"}.`);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Feature flags</CardTitle>
				<CardDescription>
					Turn platform capabilities on or off for every organization.
				</CardDescription>
			</CardHeader>
			<CardContent className="divide-y">
				{FLAGS.map((flag) => (
					<div
						className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
						key={flag.key}
					>
						<div className="min-w-0 space-y-0.5">
							<Label
								className="font-medium text-sm"
								htmlFor={`flag-${flag.key}`}
							>
								{flag.label}
							</Label>
							<p className="text-muted-foreground text-sm">
								{flag.description}
							</p>
						</div>
						<Switch
							checked={flags[flag.key] ?? false}
							id={`flag-${flag.key}`}
							onCheckedChange={() => toggle(flag.key, flag.label)}
						/>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
