import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
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
import { updateServerVariables, useServer } from "@/lib/servers-store";
import type { ServerRow } from "@/lib/stubs";
import {
	controlForVariable,
	shownVariables,
	type Template,
	type TemplateVariable,
} from "@/lib/templates";
import { useTemplate } from "@/lib/templates-store";

export const Route = createFileRoute("/_app/servers/$serverId/startup")({
	component: ServerStartupTab,
});

function ServerStartupTab() {
	const { serverId } = Route.useParams();
	const server = useServer(serverId);
	const template = useTemplate(server?.templateId ?? "");

	if (!server) {
		return null;
	}

	return (
		<div className="space-y-6">
			<RuntimeCard server={server} template={template} />
			{template ? (
				<>
					<VariablesCard server={server} template={template} />
					<StartupCommandCard template={template} />
				</>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>Variables</CardTitle>
						<CardDescription>
							The source template is no longer available, so its variables can't
							be shown.
						</CardDescription>
					</CardHeader>
				</Card>
			)}
		</div>
	);
}

function RuntimeCard({
	server,
	template,
}: {
	server: ServerRow;
	template: Template | undefined;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Runtime</CardTitle>
				<CardDescription>
					The template and image this server was deployed from.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4 sm:grid-cols-3">
					<Field label="Template" value={server.templateName} />
					<Field label="Image" value={server.imageLabel} />
					<Field
						label="Template version"
						value={template ? `v${template.version}` : "—"}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="space-y-1">
			<div className="text-muted-foreground text-xs">{label}</div>
			<div className="font-medium text-sm">{value}</div>
		</div>
	);
}

// The shown (editable + read-only) variables' values, seeded from the server's
// stored snapshot (falling back to the template default). Read-only vars are
// seeded so they display their value; secrets are write-only and never seeded.
// Top-level + pure so the effect below can key off the stored values directly.
function seedValues(template: Template, stored: Record<string, string>) {
	const next: Record<string, string> = {};
	for (const variable of template.variables) {
		if (variable.access === "editable" || variable.access === "read-only") {
			next[variable.envVariable] =
				stored[variable.envVariable] ?? variable.defaultValue ?? "";
		}
	}
	return next;
}

function VariablesCard({
	server,
	template,
}: {
	server: ServerRow;
	template: Template;
}) {
	const fields = shownVariables(template);
	const [values, setValues] = useState<Record<string, string>>(() =>
		seedValues(template, server.variables)
	);
	// Secret edits are local-only and write-only — never folded into the readable
	// snapshot. Empty = "keep current"; cleared after a save.
	const [secrets, setSecrets] = useState<Record<string, string>>({});

	// Re-seed only when the *stored* values change (e.g. after a save) or the
	// template is swapped. Keyed on `server.variables` rather than the whole row,
	// so a power transition — which leaves `variables` untouched — can't wipe an
	// in-progress edit.
	useEffect(() => {
		setValues(seedValues(template, server.variables));
	}, [template, server.variables]);

	const editableChanged = template.variables.some(
		(v) =>
			v.access === "editable" &&
			values[v.envVariable] !==
				(server.variables[v.envVariable] ?? v.defaultValue ?? "")
	);
	const secretsChanged = Object.values(secrets).some((v) => v.trim() !== "");
	const changed = editableChanged || secretsChanged;

	function valueFor(variable: TemplateVariable) {
		return variable.access === "secret"
			? (secrets[variable.envVariable] ?? "")
			: values[variable.envVariable];
	}

	function setValueFor(variable: TemplateVariable, value: string) {
		if (variable.access === "secret") {
			setSecrets((current) => ({ ...current, [variable.envVariable]: value }));
		} else {
			setValues((current) => ({ ...current, [variable.envVariable]: value }));
		}
	}

	function save() {
		// Persist only the editable values; read-only stays as-is and secrets are
		// never written to the client-safe snapshot (a real impl rotates them over
		// a separate write-only path).
		const next = { ...server.variables };
		for (const variable of template.variables) {
			if (variable.access === "editable") {
				next[variable.envVariable] = values[variable.envVariable];
			}
		}
		updateServerVariables(server.id, next);
		setSecrets({});
		toast.success("Startup variables saved.");
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
	variable: TemplateVariable;
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

function StartupCommandCard({ template }: { template: Template }) {
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
					{template.startupCommand}
				</pre>
			</CardContent>
		</Card>
	);
}
