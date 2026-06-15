import { Link, useNavigate } from "@tanstack/react-router";
import {
	Boxes,
	Circle,
	CircleCheck,
	Database,
	FileCheck,
	Image as ImageIcon,
	KeyRound,
	Lock,
	Pencil,
	Plug,
	Plus,
	Puzzle,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/shared/code-editor";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { VariableEditorDialog } from "@/components/templates/variable-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
	type DoneMatcher,
	FEATURE_METADATA,
	INSTALL_ENTRYPOINTS,
	type InstallEntrypoint,
	type StopType,
	TEMPLATE_CATEGORIES,
	type TemplateCategory,
} from "@/lib/domain/templates";
import {
	type EditorImage,
	type EditorState,
	type EditorVariable,
	stateToInput,
} from "@/lib/domain/templates-editor";
import { createTemplate, updateTemplate } from "@/lib/stores/templates-store";
import { cn } from "@/lib/utils";

const TABS = [
	{ key: "overview", label: "Overview" },
	{ key: "runtimes", label: "Runtimes" },
	{ key: "variables", label: "Variables" },
	{ key: "startup", label: "Startup" },
	{ key: "install", label: "Install" },
	{ key: "addons", label: "Add-ons" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const FEATURE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
	"minecraft:eula": FileCheck,
	"minecraft:bukkit-plugins": Plug,
	"minecraft:mods": Boxes,
	"steam:gslt": KeyRound,
	"database:browser": Database,
};

export function TemplateEditor({
	mode,
	templateId,
	initial,
}: {
	mode: "create" | "edit";
	templateId?: string;
	initial: EditorState;
}) {
	const navigate = useNavigate();
	const [state, setState] = useState<EditorState>(initial);
	const [tab, setTab] = useState<TabKey>("overview");
	// Once the Install tab is opened, keep its (heavy) Monaco editor mounted so
	// switching tabs doesn't unmount and reload it.
	const [installMounted, setInstallMounted] = useState(false);
	useEffect(() => {
		if (tab === "install") {
			setInstallMounted(true);
		}
	}, [tab]);

	function patch(next: Partial<EditorState>) {
		setState((current) => ({ ...current, ...next }));
	}

	function save() {
		if (!state.name.trim()) {
			toast.error("Give your template a name.");
			setTab("overview");
			return;
		}
		const input = stateToInput(state);
		if (mode === "create") {
			const created = createTemplate(input);
			toast.success(`Created “${created.name}”.`);
			navigate({
				params: { templateId: created.id },
				to: "/templates/$templateId/edit",
			});
		} else if (templateId) {
			updateTemplate(templateId, input);
			toast.success("Changes saved.");
		}
	}

	return (
		<div className="space-y-6">
			<div
				aria-label="Template sections"
				className="flex flex-wrap items-center gap-1 border-b"
				role="tablist"
			>
				{TABS.map((entry) => (
					<button
						aria-controls={`tpl-panel-${entry.key}`}
						aria-selected={tab === entry.key}
						className={cn(
							"-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors",
							tab === entry.key
								? "border-primary text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						)}
						id={`tpl-tab-${entry.key}`}
						key={entry.key}
						onClick={() => setTab(entry.key)}
						role="tab"
						type="button"
					>
						{entry.label}
					</button>
				))}
			</div>

			<div
				aria-labelledby={`tpl-tab-${tab}`}
				id={`tpl-panel-${tab}`}
				role="tabpanel"
			>
				{tab === "overview" ? (
					<OverviewTab patch={patch} state={state} />
				) : null}
				{tab === "runtimes" ? (
					<RuntimesTab patch={patch} state={state} />
				) : null}
				{tab === "variables" ? (
					<VariablesTab patch={patch} state={state} />
				) : null}
				{tab === "startup" ? <StartupTab patch={patch} state={state} /> : null}
				{tab === "install" || installMounted ? (
					<div className={tab === "install" ? undefined : "hidden"}>
						<InstallTab patch={patch} state={state} />
					</div>
				) : null}
				{tab === "addons" ? <AddonsTab patch={patch} state={state} /> : null}
			</div>

			<div className="flex items-center justify-end gap-2 border-t pt-4">
				<Button asChild variant="ghost">
					{mode === "edit" && templateId ? (
						<Link params={{ templateId }} to="/templates/$templateId">
							Cancel
						</Link>
					) : (
						<Link to="/templates">Cancel</Link>
					)}
				</Button>
				<Button onClick={save}>
					{mode === "create" ? "Create template" : "Save changes"}
				</Button>
			</div>
		</div>
	);
}

type TabProps = {
	state: EditorState;
	patch: (next: Partial<EditorState>) => void;
};

function OverviewTab({ state, patch }: TabProps) {
	return (
		<div className="max-w-2xl space-y-4">
			<div className="grid gap-2">
				<Label>Icon</Label>
				<ImageUploadField
					icon={ImageIcon}
					label="Upload icon"
					onChange={(iconUrl) => patch({ iconUrl })}
					shape="square"
					value={state.iconUrl}
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="tpl-name">Name</Label>
				<Input
					id="tpl-name"
					onChange={(event) => patch({ name: event.target.value })}
					placeholder="Minecraft: Java"
					value={state.name}
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="tpl-category">Category</Label>
				<Select
					onValueChange={(value) =>
						patch({ category: value as TemplateCategory })
					}
					value={state.category}
				>
					<SelectTrigger className="w-56" id="tpl-category">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TEMPLATE_CATEGORIES.map((category) => (
							<SelectItem key={category} value={category}>
								{category}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="tpl-summary">Summary</Label>
				<Input
					id="tpl-summary"
					onChange={(event) => patch({ summary: event.target.value })}
					placeholder="One line shown on the catalog card."
					value={state.summary}
				/>
			</div>
			<div className="grid gap-2">
				<Label htmlFor="tpl-description">Description</Label>
				<Textarea
					id="tpl-description"
					onChange={(event) => patch({ description: event.target.value })}
					placeholder="What this template runs, and anything players should know."
					rows={5}
					value={state.description}
				/>
			</div>
		</div>
	);
}

function RuntimesTab({ state, patch }: TabProps) {
	function update(index: number, next: Partial<EditorImage>) {
		patch({
			images: state.images.map((image, i) =>
				i === index ? { ...image, ...next } : image
			),
		});
	}
	function setDefault(index: number) {
		patch({
			images: state.images.map((image, i) => ({
				...image,
				isDefault: i === index,
			})),
		});
	}
	function remove(index: number) {
		patch({ images: state.images.filter((_, i) => i !== index) });
	}
	function add() {
		patch({
			images: [
				...state.images,
				{
					id: crypto.randomUUID(),
					image: "",
					isDefault: state.images.length === 0,
					label: "",
				},
			],
		});
	}

	return (
		<div className="max-w-3xl space-y-4">
			<p className="text-muted-foreground text-sm">
				The runtimes players can pick. Give each a friendly label and the
				container image it runs.
			</p>
			<div className="space-y-3">
				{state.images.map((image, index) => (
					<div
						className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
						key={image.id}
					>
						<div className="flex-1 space-y-1.5">
							<Label className="text-xs" htmlFor={`runtime-label-${index}`}>
								Label
							</Label>
							<Input
								id={`runtime-label-${index}`}
								onChange={(event) =>
									update(index, { label: event.target.value })
								}
								placeholder="Java 21"
								value={image.label}
							/>
						</div>
						<div className="flex-[2] space-y-1.5">
							<Label className="text-xs" htmlFor={`runtime-image-${index}`}>
								Image
							</Label>
							<Input
								className="font-mono text-xs"
								id={`runtime-image-${index}`}
								onChange={(event) =>
									update(index, { image: event.target.value })
								}
								placeholder="ghcr.io/pterodactyl/yolks:java_21"
								value={image.image}
							/>
						</div>
						<Button
							onClick={() => setDefault(index)}
							size="sm"
							type="button"
							variant={image.isDefault ? "secondary" : "outline"}
						>
							<Star className="size-3.5" />
							{image.isDefault ? "Default" : "Set default"}
						</Button>
						<Button
							aria-label="Remove runtime"
							onClick={() => remove(index)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<Trash2 className="size-4" />
						</Button>
					</div>
				))}
			</div>
			<Button onClick={add} size="sm" type="button" variant="outline">
				<Plus className="size-4" /> Add runtime
			</Button>
		</div>
	);
}

function VariablesTab({ state, patch }: TabProps) {
	function upsert(index: number | null, variable: EditorVariable) {
		patch({
			variables:
				index === null
					? [...state.variables, variable]
					: state.variables.map((current, i) =>
							i === index ? variable : current
						),
		});
	}
	function remove(index: number) {
		patch({ variables: state.variables.filter((_, i) => i !== index) });
	}

	return (
		<div className="max-w-3xl space-y-4">
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">
					Settings filled in before a server starts.
				</p>
				<VariableEditorDialog
					onSave={(variable) => upsert(null, variable)}
					trigger={
						<Button size="sm" type="button" variant="outline">
							<Plus className="size-4" /> Add variable
						</Button>
					}
				/>
			</div>
			{state.variables.length === 0 ? (
				<div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center text-muted-foreground text-sm">
					No variables yet.
				</div>
			) : (
				<div className="divide-y overflow-hidden rounded-lg border">
					{state.variables.map((variable, index) => (
						<div
							className="flex items-center gap-3 bg-card px-4 py-3"
							key={variable.id}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate font-medium text-sm">
										{variable.name}
									</span>
									{variable.access === "secret" ? (
										<Badge variant="secondary">
											<Lock /> Secret
										</Badge>
									) : (
										<Badge variant="outline">{variable.access}</Badge>
									)}
								</div>
								<div className="mt-0.5 font-mono text-muted-foreground text-xs">
									{variable.envVariable}
								</div>
							</div>
							<VariableEditorDialog
								initial={variable}
								onSave={(next) => upsert(index, next)}
								trigger={
									<Button
										aria-label="Edit variable"
										size="icon"
										type="button"
										variant="ghost"
									>
										<Pencil className="size-4" />
									</Button>
								}
							/>
							<Button
								aria-label="Remove variable"
								onClick={() => remove(index)}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Trash2 className="size-4" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function StartupTab({ state, patch }: TabProps) {
	function updateMarker(index: number, next: DoneMatcher) {
		patch({
			doneMarkers: state.doneMarkers.map((entry, i) =>
				i === index ? { ...entry, matcher: next } : entry
			),
		});
	}
	return (
		<div className="max-w-2xl space-y-4">
			<div className="grid gap-2">
				<Label htmlFor="tpl-startup">Startup command</Label>
				<Textarea
					className="font-mono text-xs"
					id="tpl-startup"
					onChange={(event) => patch({ startupCommand: event.target.value })}
					placeholder="java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar"
					rows={3}
					value={state.startupCommand}
				/>
				<p className="text-muted-foreground text-xs">
					Use {"{{VARIABLE}}"} to insert a variable, e.g. {"{{SERVER_MEMORY}}"}.
				</p>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="grid gap-2">
					<Label htmlFor="tpl-stop-type">Stop with</Label>
					<Select
						onValueChange={(value) => patch({ stopType: value as StopType })}
						value={state.stopType}
					>
						<SelectTrigger className="w-40" id="tpl-stop-type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="command">A command</SelectItem>
							<SelectItem value="signal">A signal</SelectItem>
							<SelectItem value="native">Server default</SelectItem>
						</SelectContent>
					</Select>
				</div>
				{state.stopType !== "native" ? (
					<div className="grid flex-1 gap-2">
						<Label htmlFor="tpl-stop-value">
							{state.stopType === "signal" ? "Signal" : "Command"}
						</Label>
						<Input
							className="font-mono"
							id="tpl-stop-value"
							onChange={(event) => patch({ stopValue: event.target.value })}
							placeholder={state.stopType === "signal" ? "SIGINT" : "stop"}
							value={state.stopValue}
						/>
					</div>
				) : null}
			</div>
			<div className="grid gap-2">
				<Label>Ready signals</Label>
				<p className="text-muted-foreground text-xs">
					Lines in the log that mean the server is up. Optional.
				</p>
				<div className="space-y-2">
					{state.doneMarkers.map(({ id, matcher }, index) => (
						<div className="flex items-center gap-2" key={id}>
							<Select
								onValueChange={(value) =>
									updateMarker(
										index,
										value === "regex"
											? { kind: "regex", pattern: "" }
											: { kind: "string", value: "" }
									)
								}
								value={matcher.kind}
							>
								<SelectTrigger
									aria-label={`Ready signal ${index + 1} match type`}
									className="w-32"
									size="sm"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="string">Contains</SelectItem>
									<SelectItem value="regex">Matches</SelectItem>
								</SelectContent>
							</Select>
							<Input
								aria-label={`Ready signal ${index + 1} pattern`}
								className="flex-1 font-mono text-xs"
								onChange={(event) =>
									updateMarker(
										index,
										matcher.kind === "regex"
											? { kind: "regex", pattern: event.target.value }
											: { kind: "string", value: event.target.value }
									)
								}
								placeholder={matcher.kind === "regex" ? "^Done \\(" : "Done ("}
								value={
									matcher.kind === "regex" ? matcher.pattern : matcher.value
								}
							/>
							<Button
								aria-label="Remove signal"
								onClick={() =>
									patch({
										doneMarkers: state.doneMarkers.filter(
											(entry) => entry.id !== id
										),
									})
								}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Trash2 className="size-4" />
							</Button>
						</div>
					))}
				</div>
				<Button
					onClick={() =>
						patch({
							doneMarkers: [
								...state.doneMarkers,
								{
									id: crypto.randomUUID(),
									matcher: { kind: "string", value: "" },
								},
							],
						})
					}
					size="sm"
					type="button"
					variant="outline"
				>
					<Plus className="size-4" /> Add signal
				</Button>
			</div>
		</div>
	);
}

function InstallTab({ state, patch }: TabProps) {
	return (
		<div className="max-w-3xl space-y-4">
			<p className="text-muted-foreground text-sm">
				A script that runs once, in a locked-down sandbox, the first time a
				server is set up from this template. Use it to download server files
				into <span className="font-mono text-xs">/mnt/server</span>. Leave it
				blank for runtimes that need no setup.
			</p>
			<div className="flex flex-wrap gap-3">
				<div className="min-w-64 flex-[2] space-y-2">
					<Label htmlFor="tpl-install-image">Install image</Label>
					<Input
						className="font-mono text-xs"
						id="tpl-install-image"
						onChange={(event) =>
							patch({ installContainerImage: event.target.value })
						}
						placeholder="ghcr.io/pterodactyl/installers:debian"
						value={state.installContainerImage}
					/>
				</div>
				<div className="w-40 space-y-2">
					<Label htmlFor="tpl-entrypoint">Shell</Label>
					<Select
						onValueChange={(value) =>
							patch({ installEntrypoint: value as InstallEntrypoint })
						}
						value={state.installEntrypoint}
					>
						<SelectTrigger className="w-full" id="tpl-entrypoint">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{INSTALL_ENTRYPOINTS.map((entrypoint) => (
								<SelectItem key={entrypoint} value={entrypoint}>
									{entrypoint}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<p className="text-muted-foreground text-xs">
				The shell runs your script on the box. Use bash unless your install
				image only ships sh or ash (for example, Alpine).
			</p>
			<div className="grid gap-2">
				<Label>Install script</Label>
				<CodeEditor
					language="shell"
					onChange={(value) => patch({ installScript: value })}
					value={state.installScript}
				/>
			</div>
		</div>
	);
}

function AddonsTab({ state, patch }: TabProps) {
	const activeKeys = new Set(state.features.map((feature) => feature.key));
	function toggle(key: string) {
		patch({
			features: activeKeys.has(key)
				? state.features.filter((feature) => feature.key !== key)
				: [...state.features, { key }],
		});
	}
	function removeFeature(key: string) {
		patch({
			features: state.features.filter((feature) => feature.key !== key),
		});
	}
	const unknown = state.features.filter(
		(feature) => !(feature.key in FEATURE_METADATA)
	);

	return (
		<div className="max-w-3xl space-y-4">
			<p className="text-muted-foreground text-sm">
				Extra tools players get for servers built from this template. Turn on
				the ones that apply.
			</p>
			<div className="grid gap-3 sm:grid-cols-2">
				{Object.entries(FEATURE_METADATA).map(([key, meta]) => {
					const Icon = FEATURE_ICONS[key] ?? Puzzle;
					const on = activeKeys.has(key);
					return (
						<button
							aria-pressed={on}
							className={cn(
								"flex flex-col gap-3 rounded-xl bg-card p-4 text-left transition-colors",
								on
									? "ring-2 ring-primary"
									: "ring-1 ring-foreground/10 hover:bg-muted/40"
							)}
							key={key}
							onClick={() => toggle(key)}
							type="button"
						>
							<div className="flex items-start gap-3">
								<span
									className={cn(
										"flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
										on
											? "bg-brand-wash text-brand"
											: "bg-muted text-muted-foreground"
									)}
								>
									<Icon className="size-4.5" strokeWidth={1.75} />
								</span>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-sm">{meta.label}</div>
									<div className="mt-0.5 text-muted-foreground text-xs">
										{meta.description}
									</div>
								</div>
								{on ? (
									<CircleCheck className="size-5 shrink-0 text-primary" />
								) : (
									<Circle className="size-5 shrink-0 text-muted-foreground/30" />
								)}
							</div>
						</button>
					);
				})}
			</div>
			{unknown.length > 0 ? (
				<div className="space-y-2">
					<p className="text-muted-foreground text-xs">
						Capabilities declared on this template that the panel has no module
						for. They're kept as-is; remove any you don't want.
					</p>
					<div className="flex flex-wrap gap-2">
						{unknown.map((feature) => (
							<span
								className="inline-flex items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2 font-mono text-muted-foreground text-xs"
								key={feature.key}
							>
								{feature.key}
								<button
									aria-label={`Remove ${feature.key}`}
									className="rounded-sm p-0.5 hover:bg-accent hover:text-foreground"
									onClick={() => removeFeature(feature.key)}
									type="button"
								>
									<X className="size-3" />
								</button>
							</span>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
