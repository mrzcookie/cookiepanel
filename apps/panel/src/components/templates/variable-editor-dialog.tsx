import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { EditorVariable } from "@/components/templates/editor-types";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	VARIABLE_ACCESS_HINTS,
	VARIABLE_ACCESS_LABELS,
	VARIABLE_ACCESSES,
	VARIABLE_TYPE_LABELS,
	VARIABLE_TYPES,
	type VariableAccess,
	type VariableType,
} from "@/lib/templates";

const ENV_RE = /^[A-Z][A-Z0-9_]{0,254}$/;

function blank(): EditorVariable {
	return {
		name: "",
		description: "",
		envVariable: "",
		defaultValue: "",
		type: "text",
		required: false,
		options: [],
		access: "editable",
	};
}

/**
 * Add or edit one template variable. Authors pick a friendly type + access; the
 * editor never exposes the raw rule syntax. The env-var key format is checked
 * here (and again server-side, eventually).
 */
export function VariableEditorDialog({
	trigger,
	initial,
	onSave,
}: {
	trigger: ReactNode;
	initial?: EditorVariable;
	onSave: (variable: EditorVariable) => void;
}) {
	const [open, setOpen] = useState(false);
	const [variable, setVariable] = useState<EditorVariable>(initial ?? blank());

	function set<K extends keyof EditorVariable>(
		key: K,
		value: EditorVariable[K]
	) {
		setVariable((prev) => ({ ...prev, [key]: value }));
	}

	function submit() {
		if (!variable.name.trim()) {
			toast.error("Name the variable.");
			return;
		}
		if (!ENV_RE.test(variable.envVariable.trim())) {
			toast.error("Key must be UPPER_SNAKE_CASE, e.g. SERVER_NAME.");
			return;
		}
		if (
			variable.type === "select" &&
			variable.options.filter(Boolean).length === 0
		) {
			toast.error("Add at least one choice.");
			return;
		}
		onSave({
			...variable,
			name: variable.name.trim(),
			envVariable: variable.envVariable.trim(),
			options: variable.options.map((option) => option.trim()).filter(Boolean),
		});
		setOpen(false);
	}

	return (
		<Dialog
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setVariable(initial ?? blank());
				}
			}}
			open={open}
		>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{initial ? "Edit variable" : "Add variable"}
					</DialogTitle>
					<DialogDescription>
						A setting filled in before the server starts.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-4">
					<div className="flex flex-col gap-4 sm:flex-row">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-name">Name</Label>
							<Input
								id="var-name"
								onChange={(event) => set("name", event.target.value)}
								placeholder="Server name"
								value={variable.name}
							/>
						</div>
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-env">Key</Label>
							<Input
								className="font-mono"
								id="var-env"
								onChange={(event) =>
									set("envVariable", event.target.value.toUpperCase())
								}
								placeholder="SERVER_NAME"
								value={variable.envVariable}
							/>
						</div>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="var-desc">Description</Label>
						<Textarea
							id="var-desc"
							onChange={(event) => set("description", event.target.value)}
							placeholder="Shown next to the field."
							rows={2}
							value={variable.description}
						/>
					</div>

					<div className="flex flex-col gap-4 sm:flex-row">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-type">Type</Label>
							<Select
								onValueChange={(value) => set("type", value as VariableType)}
								value={variable.type}
							>
								<SelectTrigger className="w-full" id="var-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{VARIABLE_TYPES.map((type) => (
										<SelectItem key={type} value={type}>
											{VARIABLE_TYPE_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-required">Required</Label>
							<Select
								onValueChange={(value) => set("required", value === "yes")}
								value={variable.required ? "yes" : "no"}
							>
								<SelectTrigger className="w-full" id="var-required">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="yes">Required</SelectItem>
									<SelectItem value="no">Optional</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{variable.type === "select" ? (
						<div className="grid gap-2">
							<Label htmlFor="var-options">Choices</Label>
							<Input
								id="var-options"
								onChange={(event) =>
									set(
										"options",
										event.target.value.split(",").map((option) => option.trim())
									)
								}
								placeholder="easy, normal, hard"
								value={variable.options.join(", ")}
							/>
							<p className="text-muted-foreground text-xs">
								Separate choices with commas.
							</p>
						</div>
					) : null}

					<div className="flex flex-col gap-4 sm:flex-row">
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-default">Default</Label>
							<Input
								disabled={variable.access === "secret"}
								id="var-default"
								onChange={(event) => set("defaultValue", event.target.value)}
								placeholder={
									variable.access === "secret" ? "Set per server" : "Optional"
								}
								value={variable.defaultValue}
							/>
						</div>
						<div className="grid flex-1 gap-2">
							<Label htmlFor="var-access">Access</Label>
							<Select
								onValueChange={(value) =>
									set("access", value as VariableAccess)
								}
								value={variable.access}
							>
								<SelectTrigger className="h-auto w-full" id="var-access">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{VARIABLE_ACCESSES.map((access) => (
										<SelectItem key={access} value={access}>
											<div className="flex flex-col gap-0.5">
												<span>{VARIABLE_ACCESS_LABELS[access]}</span>
												<span className="text-muted-foreground text-xs">
													{VARIABLE_ACCESS_HINTS[access]}
												</span>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button
						onClick={() => setOpen(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button onClick={submit} type="button">
						{initial ? "Save" : "Add"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
