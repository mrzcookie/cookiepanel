import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	controlForVariable,
	type TemplateVariable,
} from "@/lib/domain/templates";

// One player-facing template variable, rendered by its derived control. Shared
// by the use-template dialog and the create-server wizard so a variable looks
// and behaves identically in both. Secrets render as a write-only password
// field; the value is never read back.
export function DeployVariableField({
	onChange,
	value,
	variable,
}: {
	onChange: (value: string) => void;
	value: string;
	variable: TemplateVariable;
}) {
	const id = `var-${variable.id}`;
	const descriptionId = variable.description ? `${id}-desc` : undefined;
	const control = controlForVariable(variable);
	const invalid = variable.required && value.trim() === "";
	return (
		<div className="grid gap-2">
			<Label htmlFor={id}>
				{variable.name}
				{variable.required ? (
					<>
						<span aria-hidden className="text-muted-foreground">
							{" *"}
						</span>
						<span className="sr-only"> (required)</span>
					</>
				) : null}
			</Label>
			{control.kind === "select" ? (
				<Select onValueChange={onChange} value={value}>
					<SelectTrigger
						aria-describedby={descriptionId}
						aria-invalid={invalid || undefined}
						aria-required={variable.required || undefined}
						className="w-full"
						id={id}
					>
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
			) : control.kind === "toggle" ? (
				<Select onValueChange={onChange} value={value || "false"}>
					<SelectTrigger
						aria-describedby={descriptionId}
						className="w-full"
						id={id}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="true">On</SelectItem>
						<SelectItem value="false">Off</SelectItem>
					</SelectContent>
				</Select>
			) : (
				<Input
					aria-describedby={descriptionId}
					aria-invalid={invalid || undefined}
					aria-required={variable.required || undefined}
					id={id}
					inputMode={control.kind === "number" ? "numeric" : undefined}
					onChange={(event) => onChange(event.target.value)}
					required={variable.required}
					type={control.kind === "secret" ? "password" : "text"}
					value={value}
				/>
			)}
			{variable.description ? (
				<p className="text-muted-foreground text-xs" id={descriptionId}>
					{variable.description}
				</p>
			) : null}
		</div>
	);
}
