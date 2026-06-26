import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChangeEggButton } from "@/components/servers/egg-switcher";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
	controlForVariable,
	type Egg,
	type EggVariable,
	shownVariables,
} from "@/lib/domain/eggs";
import type { ServerRow } from "@/lib/domain/servers";
import { useEgg } from "@/lib/eggs-queries";
import {
	invalidateServers,
	updateServerRuntime,
	updateServerVariables,
	useServer,
} from "@/lib/server-queries";

export const Route = createFileRoute("/_app/servers/$serverId/startup")({
	component: ServerStartupTab,
});

function ServerStartupTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const egg = useEgg(server?.eggId ?? "");

	if (!server) {
		return null;
	}

	return (
		<div className="space-y-6">
			<RuntimeCard server={server} egg={egg} />
			{egg ? (
				<>
					<VariablesCard server={server} egg={egg} />
					<StartupCommandCard egg={egg} />
				</>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Variables</CardTitle>
						<CardDescription>
							The source egg is no longer available, so its variables can't be
							shown.
						</CardDescription>
					</CardHeader>
				</Card>
			)}
		</div>
	);
}

function RuntimeCard({
	server,
	egg,
}: {
	server: ServerRow;
	egg: Egg | undefined;
}) {
	const queryClient = useQueryClient();
	const runtimes = egg?.images ?? [];
	const switchable = runtimes.length > 1;
	const [runtime, setRuntime] = useState(server.imageLabel);

	// Re-seed when the stored runtime changes (e.g. after a save) so a stale draft
	// can't shadow the persisted value.
	useEffect(() => {
		setRuntime(server.imageLabel);
	}, [server.imageLabel]);

	const changed = runtime !== server.imageLabel;

	async function save() {
		try {
			await updateServerRuntime(server.id, runtime);
			await invalidateServers(queryClient);
			toast.success("Runtime saved. Restart the server to apply it.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't save the runtime."
			);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Runtime</CardTitle>
				<CardDescription>
					The egg and runtime this server runs on.
					{switchable
						? " Switching runtime takes effect on the next restart."
						: ""}
				</CardDescription>
				<CardAction>
					<ChangeEggButton server={server} />
				</CardAction>
			</CardHeader>
			<CardContent className={switchable ? "space-y-5" : undefined}>
				<div className="grid gap-4 sm:grid-cols-3">
					<Field label="Egg" value={server.eggName} />
					{switchable ? (
						<div className="space-y-1.5">
							<Label className="text-muted-foreground" htmlFor="server-runtime">
								Runtime
							</Label>
							<Select onValueChange={setRuntime} value={runtime}>
								<SelectTrigger className="w-full" id="server-runtime">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{runtimes.map((image) => (
										<SelectItem key={image.id} value={image.label}>
											{image.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : (
						<Field label="Runtime" mono value={server.imageLabel} />
					)}
					<Field
						label="Egg version"
						mono
						value={egg ? `v${egg.version}` : "—"}
					/>
				</div>
				{switchable ? (
					<div className="flex justify-end border-t pt-4">
						<Button disabled={!changed} onClick={save}>
							Save
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

function Field({
	label,
	mono,
	value,
}: {
	label: string;
	mono?: boolean;
	value: string;
}) {
	return (
		<div className="space-y-1.5">
			<div className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</div>
			<div
				className={
					mono ? "font-mono text-sm tabular-nums" : "font-medium text-sm"
				}
			>
				{value}
			</div>
		</div>
	);
}

// The shown (editable + read-only) variables' values, seeded from the server's
// stored snapshot (falling back to the egg default). Read-only vars are
// seeded so they display their value; secrets are write-only and never seeded.
// Top-level + pure so the effect below can key off the stored values directly.
function seedValues(egg: Egg, stored: Record<string, string>) {
	const next: Record<string, string> = {};
	for (const variable of egg.variables) {
		if (variable.access === "editable" || variable.access === "read-only") {
			next[variable.envVariable] =
				stored[variable.envVariable] ?? variable.defaultValue ?? "";
		}
	}
	return next;
}

function VariablesCard({ server, egg }: { server: ServerRow; egg: Egg }) {
	const queryClient = useQueryClient();
	const fields = shownVariables(egg);
	const [values, setValues] = useState<Record<string, string>>(() =>
		seedValues(egg, server.variables)
	);
	// Secret edits are local-only and write-only — never folded into the readable
	// snapshot. Empty = "keep current"; cleared after a save.
	const [secrets, setSecrets] = useState<Record<string, string>>({});

	// Re-seed only when the *stored* values change (e.g. after a save) or the
	// egg is swapped. Keyed on `server.variables` rather than the whole row,
	// so a power transition — which leaves `variables` untouched — can't wipe an
	// in-progress edit.
	useEffect(() => {
		setValues(seedValues(egg, server.variables));
	}, [egg, server.variables]);

	const editableChanged = egg.variables.some(
		(v) =>
			v.access === "editable" &&
			values[v.envVariable] !==
				(server.variables[v.envVariable] ?? v.defaultValue ?? "")
	);
	const secretsChanged = Object.values(secrets).some((v) => v.trim() !== "");
	const changed = editableChanged || secretsChanged;

	function valueFor(variable: EggVariable) {
		return variable.access === "secret"
			? (secrets[variable.envVariable] ?? "")
			: values[variable.envVariable];
	}

	function setValueFor(variable: EggVariable, value: string) {
		if (variable.access === "secret") {
			setSecrets((current) => ({ ...current, [variable.envVariable]: value }));
		} else {
			setValues((current) => ({ ...current, [variable.envVariable]: value }));
		}
	}

	async function save() {
		// Send editable values + any secret edits; the server re-seals secrets
		// (write-only) and stores the non-secret snapshot.
		const provided: Record<string, string> = {};
		for (const variable of egg.variables) {
			if (variable.access === "editable") {
				provided[variable.envVariable] = values[variable.envVariable] ?? "";
			}
		}
		for (const [key, value] of Object.entries(secrets)) {
			if (value.trim() !== "") {
				provided[key] = value;
			}
		}
		try {
			await updateServerVariables(server.id, provided);
			await invalidateServers(queryClient);
			setSecrets({});
			toast.success("Startup variables saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't save variables."
			);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Variables</CardTitle>
				<CardDescription>
					Settings this server was deployed with. Editable ones can be changed;
					a restart applies them.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					{fields.map((variable) => (
						<VariableField
							key={variable.id}
							onChange={(value) => setValueFor(variable, value)}
							value={valueFor(variable)}
							variable={variable}
						/>
					))}
					<div className="flex justify-end border-t pt-4">
						<Button disabled={!changed} type="submit">
							Save
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function VariableField({
	onChange,
	value,
	variable,
}: {
	onChange: (value: string) => void;
	value: string | undefined;
	variable: EggVariable;
}) {
	const control = controlForVariable(variable);
	const id = `var-${variable.id}`;
	const disabled = variable.access === "read-only";

	function field() {
		if (control.kind === "secret") {
			return (
				<Input
					autoComplete="off"
					className="font-mono"
					id={id}
					onChange={(event) => onChange(event.target.value)}
					placeholder="••••••••  ·  leave blank to keep current"
					type="password"
					value={value ?? ""}
				/>
			);
		}
		if (control.kind === "toggle") {
			return (
				<Switch
					checked={value === "true"}
					disabled={disabled}
					id={id}
					onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
				/>
			);
		}
		if (control.kind === "select") {
			return (
				<Select
					disabled={disabled}
					onValueChange={onChange}
					value={value ?? ""}
				>
					<SelectTrigger className="w-full" id={id}>
						<SelectValue placeholder="Choose…" />
					</SelectTrigger>
					<SelectContent>
						{control.options.map((option) => (
							<SelectItem key={option} value={option}>
								{option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		}
		return (
			<Input
				disabled={disabled}
				id={id}
				inputMode={control.kind === "number" ? "numeric" : undefined}
				onChange={(event) => onChange(event.target.value)}
				type={control.kind === "number" ? "number" : "text"}
				value={value ?? ""}
			/>
		);
	}

	return (
		<div className="grid gap-2">
			<div className="flex items-baseline justify-between gap-3">
				<Label htmlFor={id}>{variable.name}</Label>
				{variable.access === "read-only" ? (
					<span className="text-muted-foreground text-xs">Read-only</span>
				) : null}
				{variable.access === "secret" ? (
					<span className="text-muted-foreground text-xs">
						Secret · never shown
					</span>
				) : null}
			</div>
			{field()}
			{variable.description ? (
				<p className="text-muted-foreground text-xs">{variable.description}</p>
			) : null}
		</div>
	);
}

function StartupCommandCard({ egg }: { egg: Egg }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Startup command</CardTitle>
				<CardDescription>
					Run when the server boots. <code>{"{{VARIABLE}}"}</code> tokens are
					filled in from the values above.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<pre className="overflow-x-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
					{egg.startupCommand}
				</pre>
			</CardContent>
		</Card>
	);
}
