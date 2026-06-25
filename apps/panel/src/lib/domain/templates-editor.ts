import type {
	ConfigParser,
	DoneMatcher,
	InstallEntrypoint,
	StopType,
	Template,
	TemplateCategory,
	TemplateConfigFile,
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

/** One key→value pair of a config file's `replace` map, with a stable form id so
 * key edits don't churn (the `replace` Record has no per-entry identity). */
export type EditorConfigEntry = { id: string; key: string; value: string };

/** A managed config file in editor form: the `replace` map expanded into an
 * ordered, id-keyed entry list (mirrors how doneMarkers carry an id). */
export type EditorConfigFile = {
	id: string;
	file: string;
	parser: ConfigParser;
	entries: EditorConfigEntry[];
};

export type EditorState = {
	name: string;
	summary: string;
	description: string;
	category: TemplateCategory;
	iconUrl: string | null;
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
	/** Managed config files, authored on the Config tab (or seeded from import). */
	configFiles: EditorConfigFile[];
};

export function emptyEditorState(): EditorState {
	return {
		name: "",
		summary: "",
		description: "",
		category: "Other",
		iconUrl: null,
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
		configFiles: [],
	};
}

/**
 * Hydrate the editor from an existing template. Mints fresh ids for rows that
 * have no stable identity of their own (done-markers, config files + their
 * replace entries) so the editor can key/edit/remove them — so this transform is
 * intentionally non-deterministic, the one impurity in domain/.
 */
export function templateToState(template: Template): EditorState {
	return {
		name: template.name,
		summary: template.summary,
		description: template.description,
		category: template.category,
		iconUrl: template.iconUrl,
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
		configFiles: template.configFiles.map(configFileToEditor),
	};
}

/** Expand a stored config file's `replace` map into id-keyed editor entries. */
function configFileToEditor(file: TemplateConfigFile): EditorConfigFile {
	return {
		id: crypto.randomUUID(),
		file: file.file,
		parser: file.parser,
		entries: Object.entries(file.replace).map(([key, value]) => ({
			id: crypto.randomUUID(),
			key,
			value,
		})),
	};
}

/** A blank config-file row for the editor. */
export function emptyConfigFile(): EditorConfigFile {
	return {
		id: crypto.randomUUID(),
		file: "",
		parser: "properties",
		entries: [emptyConfigEntry()],
	};
}

export function emptyConfigEntry(): EditorConfigEntry {
	return { id: crypto.randomUUID(), key: "", value: "" };
}

/**
 * Collapse the editor's config files back to the stored shape: trim the path,
 * drop files with no path, and fold the entry list into a `replace` map keeping
 * only entries with a non-empty (trimmed) key — last write wins on a dup key. A
 * file whose entries are all empty is dropped (nothing to merge).
 */
function editorToConfigFiles(files: EditorConfigFile[]): TemplateConfigFile[] {
	const out: TemplateConfigFile[] = [];
	for (const file of files) {
		const path = file.file.trim();
		if (!path) {
			continue;
		}
		const replace: Record<string, string> = {};
		for (const entry of file.entries) {
			const key = entry.key.trim();
			if (key) {
				replace[key] = entry.value;
			}
		}
		if (Object.keys(replace).length === 0) {
			continue;
		}
		out.push({ file: path, parser: file.parser, replace });
	}
	return out;
}

/** Build the store payload: trim, drop incomplete runtimes, null out secrets. */
export function stateToInput(state: EditorState): TemplateInput {
	return {
		name: state.name.trim(),
		summary: state.summary.trim(),
		description: state.description,
		category: state.category,
		iconUrl: state.iconUrl,
		startupCommand: state.startupCommand,
		stopType: state.stopType,
		stopValue: state.stopValue,
		doneMarkers: state.doneMarkers.map((entry) => entry.matcher),
		installScript: state.installScript,
		installContainerImage: state.installContainerImage.trim(),
		installEntrypoint: state.installEntrypoint,
		features: state.features,
		configFiles: editorToConfigFiles(state.configFiles),
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
