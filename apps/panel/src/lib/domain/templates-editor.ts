import type {
	DoneMatcher,
	InstallEntrypoint,
	StopType,
	Template,
	TemplateCategory,
	TemplateFeature,
	TemplateInput,
	VariableAccess,
	VariableType,
} from "@/lib/domain/templates";

// Form-state shapes for the authoring editor. The editor works in the same
// friendly terms the variable model already uses (a "type" + a single access
// choice), so the conversions here are mostly trimming and dropping empties on
// the way to the store's `TemplateInput`.

export type EditorImage = {
	id: string;
	label: string;
	image: string;
	isDefault: boolean;
};

/** A ready-signal row, paired with a stable id so edits/removals key correctly. */
export type EditorDoneMarker = { id: string; matcher: DoneMatcher };

export type EditorVariable = {
	id: string;
	name: string;
	description: string;
	envVariable: string;
	/** Always a string in the form; mapped to null (secret / empty) on save. */
	defaultValue: string;
	type: VariableType;
	required: boolean;
	options: string[];
	access: VariableAccess;
};

export type EditorState = {
	name: string;
	summary: string;
	description: string;
	category: TemplateCategory;
	images: EditorImage[];
	variables: EditorVariable[];
	startupCommand: string;
	stopType: StopType;
	stopValue: string;
	doneMarkers: EditorDoneMarker[];
	installScript: string;
	installContainerImage: string;
	installEntrypoint: InstallEntrypoint;
	features: TemplateFeature[];
};

export function emptyEditorState(): EditorState {
	return {
		name: "",
		summary: "",
		description: "",
		category: "Other",
		images: [],
		variables: [],
		startupCommand: "",
		stopType: "command",
		stopValue: "stop",
		doneMarkers: [],
		installScript: "",
		installContainerImage: "",
		installEntrypoint: "bash",
		features: [],
	};
}

/** Hydrate the editor from an existing template. */
export function templateToState(template: Template): EditorState {
	return {
		name: template.name,
		summary: template.summary,
		description: template.description,
		category: template.category,
		images: template.images.map((image) => ({
			id: image.id,
			label: image.label,
			image: image.image,
			isDefault: image.isDefault,
		})),
		variables: template.variables.map((variable) => ({
			id: variable.id,
			name: variable.name,
			description: variable.description,
			envVariable: variable.envVariable,
			defaultValue: variable.defaultValue ?? "",
			type: variable.type,
			required: variable.required,
			options: variable.options,
			access: variable.access,
		})),
		startupCommand: template.startupCommand,
		stopType: template.stopType,
		stopValue: template.stopValue,
		doneMarkers: template.doneMarkers.map((matcher) => ({
			id: crypto.randomUUID(),
			matcher,
		})),
		installScript: template.installScript,
		installContainerImage: template.installContainerImage,
		installEntrypoint: template.installEntrypoint,
		features: template.features,
	};
}

/** Build the store payload: trim, drop incomplete runtimes, null out secrets. */
export function stateToInput(state: EditorState): TemplateInput {
	return {
		name: state.name.trim(),
		summary: state.summary.trim(),
		description: state.description,
		category: state.category,
		startupCommand: state.startupCommand,
		stopType: state.stopType,
		stopValue: state.stopValue,
		doneMarkers: state.doneMarkers.map((entry) => entry.matcher),
		installScript: state.installScript,
		installContainerImage: state.installContainerImage.trim(),
		installEntrypoint: state.installEntrypoint,
		features: state.features,
		images: state.images
			.filter((image) => image.label.trim() && image.image.trim())
			.map((image) => ({
				label: image.label.trim(),
				image: image.image.trim(),
				isDefault: image.isDefault,
			})),
		variables: state.variables.map((variable) => ({
			name: variable.name.trim(),
			description: variable.description,
			envVariable: variable.envVariable.trim(),
			defaultValue:
				variable.access === "secret" || !variable.defaultValue
					? null
					: variable.defaultValue,
			type: variable.type,
			required: variable.required,
			options: variable.options,
			access: variable.access,
		})),
	};
}
