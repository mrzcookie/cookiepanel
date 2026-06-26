import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutTemplate, Plus, Server, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { DeployVariableField } from "@/components/servers/deploy-variable-field";
import { EggPicker } from "@/components/servers/egg-picker";
import { NodePicker } from "@/components/servers/node-picker";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import { WizardFrame } from "@/components/wizard/wizard-frame";
import type { WizardStep } from "@/components/wizard/wizard-stepper";
import { nodeAllocationsQueryOptions } from "@/lib/allocation-queries";
import {
	basePortFor,
	clampInt,
	GiB,
	isDeployTarget,
	serverCaps,
} from "@/lib/domain/deploy";
import {
	defaultRuntimeLabel,
	deployVariables,
	type Egg,
	isDeployable,
} from "@/lib/domain/eggs";
import type { AllocationProtocol, AllocationRow } from "@/lib/domain/networks";
import type { NodeRow } from "@/lib/domain/nodes";
import { bumpEggServerCount, useEggs } from "@/lib/eggs-queries";
import { formatBytes } from "@/lib/format";
import { useNodes } from "@/lib/node-queries";
import { createServer, invalidateServers } from "@/lib/server-queries";

const STEPS: WizardStep[] = [
	{ id: "egg", label: "Egg" },
	{ id: "placement", label: "Placement" },
	{ id: "settings", label: "Settings" },
	{ id: "resources", label: "Resources" },
	{ id: "review", label: "Review" },
];

const HEADINGS = [
	{
		description:
			"Pick what you want to run. We'll handle the runtime, install, and setup.",
		title: "Choose a egg",
	},
	{
		description:
			"Pick a connected node. Only nodes that are online can take a new server.",
		title: "Where should it run?",
	},
	{
		description: "Give your server a name, then fill in the egg's settings.",
		title: "Name it and set it up",
	},
	{
		description: "Caps for this server, and the port players connect to.",
		title: "Set its limits",
	},
	{
		description: "Here's what we'll create. Go back to change anything.",
		title: "Review and deploy",
	},
] as const;

type Draft = {
	eggId: string | null;
	nodeId: string | null;
	name: string;
	runtimeLabel: string;
	values: Record<string, string>;
	cpuCores: number;
	memGb: number;
	diskGb: number;
	/** Kept as a string for the input; parsed when validated. */
	port: string;
	protocol: AllocationProtocol;
};

function seedValues(egg: Egg): Record<string, string> {
	const seed: Record<string, string> = {};
	for (const variable of deployVariables(egg)) {
		seed[variable.envVariable] = variable.defaultValue ?? "";
	}
	return seed;
}

function nextFreePort(
	base: number,
	protocol: AllocationProtocol,
	allocations: AllocationRow[]
): number {
	const used = (p: number) =>
		allocations.some((a) => a.port === p && a.protocol === protocol);
	let port = base;
	for (let i = 0; i < 500 && used(port); i++) {
		port++;
	}
	return Math.min(port, 65535);
}

// The create-a-server wizard: Egg → Placement → Settings → Resources →
// Review, then deploy. Local state until deploy; only then does it create the
// server (installing → running), reserve the port, and bump the egg's
// server count. A raw image string is never shown — runtimes are friendly
// labels. `preselectId` (from ?egg=) jumps a deployable egg straight to
// Placement.
export function CreateServerWizard({ preselectId }: { preselectId?: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const eggs = useEggs();
	const nodes = useNodes();

	const deployableEggs = eggs.filter(isDeployable);
	const preselect = preselectId
		? eggs.find((egg) => egg.id === preselectId)
		: undefined;
	const preselectDeployable = Boolean(preselect && isDeployable(preselect));

	const [step, setStep] = useState(preselectDeployable ? 1 : 0);
	const [draft, setDraft] = useState<Draft>(() => {
		const base: Draft = {
			cpuCores: 2,
			diskGb: 20,
			memGb: 4,
			name: "",
			nodeId: null,
			port: "",
			protocol: "tcp",
			runtimeLabel: "",
			eggId: null,
			values: {},
		};
		if (preselect && isDeployable(preselect)) {
			return {
				...base,
				runtimeLabel: defaultRuntimeLabel(preselect),
				eggId: preselect.id,
				values: seedValues(preselect),
			};
		}
		return base;
	});

	const egg = draft.eggId
		? eggs.find((item) => item.id === draft.eggId)
		: undefined;
	const node = draft.nodeId
		? nodes.find((item) => item.id === draft.nodeId)
		: undefined;
	const selectableNodes = nodes.filter(isDeployTarget);
	// The selected node's allocations — for the free-port suggestion + in-use check.
	const nodeAllocations =
		useQuery({
			...nodeAllocationsQueryOptions(draft.nodeId ?? ""),
			enabled: Boolean(draft.nodeId),
		}).data ?? [];
	const portUsed = (port: number, protocol: AllocationProtocol) =>
		nodeAllocations.some((a) => a.port === port && a.protocol === protocol);

	function selectEgg(id: string) {
		const next = eggs.find((item) => item.id === id);
		if (!next || !isDeployable(next)) {
			return;
		}
		setDraft((current) => ({
			...current,
			runtimeLabel: defaultRuntimeLabel(next),
			eggId: id,
			values: seedValues(next),
		}));
	}

	function selectNode(id: string) {
		const next = nodes.find((item) => item.id === id);
		if (!next || !isDeployTarget(next) || !egg) {
			return;
		}
		setDraft((current) => {
			const caps = serverCaps(next);
			const currentPort = Number(current.port);
			const keepPort =
				current.port !== "" &&
				Number.isInteger(currentPort) &&
				currentPort >= 1 &&
				currentPort <= 65535;
			return {
				...current,
				cpuCores: clampInt(current.cpuCores, 1, caps.cpuCores),
				diskGb: clampInt(current.diskGb, 1, caps.diskGb),
				memGb: clampInt(current.memGb, 1, caps.memGb),
				nodeId: id,
				// The new node's allocations load async; default to the egg's base
				// port and let the user adjust / Suggest.
				port: keepPort ? current.port : String(basePortFor(egg)),
			};
		});
	}

	function suggestPort() {
		if (!(node && egg)) {
			return;
		}
		const base = Number(draft.port) || basePortFor(egg);
		setDraft((current) => ({
			...current,
			port: String(nextFreePort(base, current.protocol, nodeAllocations)),
		}));
	}

	const caps = node ? serverCaps(node) : null;
	const requiredVariables = egg
		? deployVariables(egg).filter((variable) => variable.required)
		: [];
	const settingsValid =
		draft.name.trim() !== "" &&
		requiredVariables.every(
			(variable) => (draft.values[variable.envVariable] ?? "").trim() !== ""
		);
	const portNum = Number(draft.port);
	const portInRange =
		Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535;
	const portTaken = Boolean(
		node && portInRange && portUsed(portNum, draft.protocol)
	);
	const limitsValid = caps
		? draft.cpuCores >= 1 &&
			draft.cpuCores <= caps.cpuCores &&
			draft.memGb >= 1 &&
			draft.memGb <= caps.memGb &&
			draft.diskGb >= 1 &&
			draft.diskGb <= caps.diskGb
		: false;
	const resourcesValid = portInRange && !portTaken && limitsValid;

	const canNext =
		step === 0
			? Boolean(egg)
			: step === 1
				? Boolean(node && isDeployTarget(node))
				: step === 2
					? settingsValid
					: step === 3
						? resourcesValid
						: true;

	async function deploy() {
		if (!(egg && node) || !isDeployable(egg) || !isDeployTarget(node)) {
			toast.error("Pick a egg and a connected node.");
			return;
		}
		if (!portInRange) {
			toast.error("Enter a port between 1 and 65535.");
			return;
		}
		if (portUsed(portNum, draft.protocol)) {
			toast.error(
				`Port ${portNum}/${draft.protocol} is already in use on ${node.name}.`
			);
			return;
		}
		// Pass every deploy-variable value (incl. secrets); the server seals secrets
		// at rest and stores only the non-secret snapshot.
		const variables: Record<string, string> = {};
		for (const variable of deployVariables(egg)) {
			variables[variable.envVariable] =
				draft.values[variable.envVariable] ?? "";
		}
		try {
			const server = await createServer({
				nodeId: node.id,
				eggId: egg.id,
				name: draft.name,
				runtimeLabel: draft.runtimeLabel,
				port: portNum,
				cpuLimitCores: draft.cpuCores,
				memLimitBytes: draft.memGb * GiB,
				diskLimitBytes: draft.diskGb * GiB,
				variables,
			});
			// createServer reserved the primary port allocation server-side; just
			// bump the egg's server count.
			bumpEggServerCount(queryClient, egg.id, 1);
			await invalidateServers(queryClient);
			toast.success(`Deploying “${draft.name.trim()}” on ${node.name}.`);
			navigate({ params: { serverId: server.id }, to: "/servers/$serverId" });
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Couldn't deploy the server."
			);
		}
	}

	let gate: ReactNode = null;
	if (nodes.length === 0) {
		gate = (
			<EmptyState
				action={
					<Button asChild>
						<Link to="/nodes/new">
							<Plus />
							Connect a node
						</Link>
					</Button>
				}
				description="A server runs on a node, a Linux box you own. Connect one, then come back to deploy."
				icon={Server}
				title="Connect a node first"
			/>
		);
	} else if (deployableEggs.length === 0) {
		gate = (
			<EmptyState
				action={
					<Button asChild variant="outline">
						<Link to="/eggs">Go to eggs</Link>
					</Button>
				}
				description="A egg has to be published before you can launch a server from it. Publish one, or browse the catalog."
				icon={LayoutTemplate}
				title="No eggs to deploy"
			/>
		);
	}

	const heading = HEADINGS[step] ?? HEADINGS[0];

	let footer: ReactNode;
	if (step === 4) {
		footer = (
			<>
				<Button onClick={() => setStep(3)} variant="ghost">
					Back
				</Button>
				<Button className="ml-auto" onClick={deploy}>
					Deploy server
				</Button>
			</>
		);
	} else {
		footer = (
			<>
				{step === 0 ? (
					<Button asChild variant="ghost">
						<Link to="/servers">Cancel</Link>
					</Button>
				) : (
					<Button onClick={() => setStep((s) => s - 1)} variant="ghost">
						Back
					</Button>
				)}
				<Button
					className="ml-auto"
					disabled={!canNext}
					onClick={() => setStep((s) => s + 1)}
				>
					Next
				</Button>
			</>
		);
	}

	return (
		<>
			<PageHeader
				back={{ label: "Servers", to: "/servers" }}
				description="Pick a egg, choose where it runs, and we'll install and start it for you."
				title="Create a server"
			/>

			{gate ?? (
				<WizardFrame
					current={step}
					footer={footer}
					stepDescription={heading.description}
					stepHeading={heading.title}
					steps={STEPS}
				>
					{step === 0 ? (
						<div className="space-y-4">
							{preselect && !preselectDeployable ? (
								<div className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2.5 text-sm">
									<span className="font-mono text-[0.7rem] text-warn uppercase tracking-[0.18em]">
										{"// unavailable"}
									</span>{" "}
									“{preselect.name}” isn't ready to deploy. Pick another below.
								</div>
							) : null}
							<EggPicker
								onSelect={selectEgg}
								selectedId={draft.eggId}
								eggs={eggs}
							/>
						</div>
					) : null}

					{step === 1 ? (
						<div className="space-y-4">
							{selectableNodes.length === 0 ? (
								<div className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2.5 text-muted-foreground text-sm">
									No node can take a server right now. Bring one online, or{" "}
									<Link
										className="text-primary hover:underline"
										to="/nodes/new"
									>
										connect another
									</Link>
									.
								</div>
							) : null}
							<NodePicker
								nodes={nodes}
								onSelect={selectNode}
								selectedId={draft.nodeId}
							/>
						</div>
					) : null}

					{step === 2 && egg ? (
						<SettingsStep
							name={draft.name}
							onName={(value) =>
								setDraft((current) => ({ ...current, name: value }))
							}
							onRuntime={(value) =>
								setDraft((current) => ({ ...current, runtimeLabel: value }))
							}
							onValue={(env, value) =>
								setDraft((current) => ({
									...current,
									values: { ...current.values, [env]: value },
								}))
							}
							runtimeLabel={draft.runtimeLabel}
							egg={egg}
							values={draft.values}
						/>
					) : null}

					{step === 3 && node ? (
						<ResourcesStep
							cpuCores={draft.cpuCores}
							diskGb={draft.diskGb}
							memGb={draft.memGb}
							node={node}
							onLimit={(key, value, max) =>
								setDraft((current) => ({
									...current,
									[key]: clampInt(value, 1, max),
								}))
							}
							onPort={(value) =>
								setDraft((current) => ({ ...current, port: value }))
							}
							onProtocol={(value) =>
								setDraft((current) => ({ ...current, protocol: value }))
							}
							onSuggestPort={suggestPort}
							port={draft.port}
							portInRange={portInRange}
							portTaken={portTaken}
							protocol={draft.protocol}
						/>
					) : null}

					{step === 4 && egg && node ? (
						<ReviewStep draft={draft} node={node} egg={egg} />
					) : null}
				</WizardFrame>
			)}
		</>
	);
}

function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
			{children}
		</p>
	);
}

function SettingsStep({
	name,
	onName,
	onRuntime,
	onValue,
	runtimeLabel,
	egg,
	values,
}: {
	name: string;
	onName: (value: string) => void;
	onRuntime: (value: string) => void;
	onValue: (env: string, value: string) => void;
	runtimeLabel: string;
	egg: Egg;
	values: Record<string, string>;
}) {
	const variables = deployVariables(egg);
	const requiredMissing =
		name.trim() === "" ||
		variables.some(
			(variable) =>
				variable.required && (values[variable.envVariable] ?? "").trim() === ""
		);
	return (
		<div className="max-w-xl space-y-6">
			<div className="grid gap-2">
				<Label htmlFor="srv-name">Server name</Label>
				<Input
					aria-invalid={name.trim() === "" || undefined}
					id="srv-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="survival-smp"
					value={name}
				/>
				<p className="text-muted-foreground text-xs">
					Players never see this. It's just your label.
				</p>
			</div>

			{egg.images.length > 1 ? (
				<div className="grid gap-2">
					<Label htmlFor="srv-runtime">Runtime</Label>
					<Select onValueChange={onRuntime} value={runtimeLabel}>
						<SelectTrigger className="w-full" id="srv-runtime">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{egg.images.map((image) => (
								<SelectItem key={image.id} value={image.label}>
									{image.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}

			{variables.length > 0 ? (
				<div className="space-y-4">
					<Eyebrow>{"// egg settings"}</Eyebrow>
					{variables.map((variable) => (
						<DeployVariableField
							key={variable.id}
							onChange={(value) => onValue(variable.envVariable, value)}
							value={values[variable.envVariable] ?? ""}
							variable={variable}
						/>
					))}
				</div>
			) : (
				<EmptyState
					description="This egg runs with sensible defaults. Nothing to fill in here."
					icon={SlidersHorizontal}
					title="No settings needed"
				/>
			)}

			{requiredMissing ? (
				<p className="text-muted-foreground text-xs">
					Name your server and complete the required settings to continue.
				</p>
			) : null}
		</div>
	);
}

function ResourcesStep({
	cpuCores,
	diskGb,
	memGb,
	node,
	onLimit,
	onPort,
	onProtocol,
	onSuggestPort,
	port,
	portInRange,
	portTaken,
	protocol,
}: {
	cpuCores: number;
	diskGb: number;
	memGb: number;
	node: NodeRow;
	onLimit: (
		key: "cpuCores" | "memGb" | "diskGb",
		value: number,
		max: number
	) => void;
	onPort: (value: string) => void;
	onProtocol: (value: AllocationProtocol) => void;
	onSuggestPort: () => void;
	port: string;
	portInRange: boolean;
	portTaken: boolean;
	protocol: AllocationProtocol;
}) {
	const caps = serverCaps(node);
	return (
		<div className="max-w-xl space-y-6">
			<div className="space-y-5">
				<Eyebrow>{"// limits"}</Eyebrow>
				<LimitField
					id="lim-cpu"
					label="CPU cores"
					max={caps.cpuCores}
					note={`Up to ${caps.cpuCores} cores on ${node.name}.`}
					onChange={(value) => onLimit("cpuCores", value, caps.cpuCores)}
					unit="cores"
					value={cpuCores}
				/>
				<LimitField
					id="lim-mem"
					label="Memory"
					max={caps.memGb}
					note={`Up to ${caps.memGb} GB on ${node.name}.`}
					onChange={(value) => onLimit("memGb", value, caps.memGb)}
					unit="GB"
					value={memGb}
				/>
				<LimitField
					id="lim-disk"
					label="Disk"
					max={caps.diskGb}
					note={`Up to ${caps.diskGb} GB on ${node.name}.`}
					onChange={(value) => onLimit("diskGb", value, caps.diskGb)}
					unit="GB"
					value={diskGb}
				/>
			</div>

			<div className="space-y-3 border-t pt-5">
				<Eyebrow>{"// primary port"}</Eyebrow>
				<p className="text-muted-foreground text-xs">
					The address players connect to.
				</p>
				<div className="flex flex-wrap items-end gap-4">
					<div className="grid gap-2">
						<Label htmlFor="srv-port">Port</Label>
						<Input
							aria-describedby="srv-port-msg"
							aria-invalid={!portInRange || portTaken}
							className="w-28 tabular-nums"
							id="srv-port"
							inputMode="numeric"
							max={65535}
							min={1}
							onChange={(event) => onPort(event.target.value)}
							type="number"
							value={port}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="srv-proto">Protocol</Label>
						<Select
							onValueChange={(value) => onProtocol(value as AllocationProtocol)}
							value={protocol}
						>
							<SelectTrigger className="w-28" id="srv-proto">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="tcp">TCP</SelectItem>
								<SelectItem value="udp">UDP</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				{!portInRange ? (
					<p className="text-destructive text-xs" id="srv-port-msg">
						Enter a port between 1 and 65535.
					</p>
				) : portTaken ? (
					<p className="text-destructive text-xs" id="srv-port-msg">
						Port {port}/{protocol} is already in use on {node.name}.{" "}
						<button
							className="underline hover:no-underline"
							onClick={onSuggestPort}
							type="button"
						>
							Suggest a free one
						</button>
					</p>
				) : (
					<p className="sr-only" id="srv-port-msg">
						Port available.
					</p>
				)}
			</div>
		</div>
	);
}

function LimitField({
	id,
	label,
	max,
	note,
	onChange,
	unit,
	value,
}: {
	id: string;
	label: string;
	max: number;
	note: string;
	onChange: (value: number) => void;
	unit: string;
	value: number;
}) {
	return (
		<div className="grid gap-2">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<Input
					className="w-28 tabular-nums"
					id={id}
					inputMode="numeric"
					max={max}
					min={1}
					onChange={(event) => onChange(Number(event.target.value))}
					step={1}
					type="number"
					value={value}
				/>
				<span className="text-muted-foreground text-xs">{unit}</span>
			</div>
			<p className="text-muted-foreground text-xs">{note}</p>
		</div>
	);
}

function ReviewStep({
	draft,
	node,
	egg,
}: {
	draft: Draft;
	node: NodeRow;
	egg: Egg;
}) {
	const variables = deployVariables(egg);
	return (
		<div className="max-w-xl space-y-5">
			<DetailList>
				<DetailRow label="Egg" value={egg.name} />
				<DetailRow label="Runtime" value={draft.runtimeLabel || "—"} />
				<DetailRow label="Server name" value={draft.name.trim() || "—"} />
				<DetailRow label="Node" value={node.name} />
				<DetailRow
					copyable
					label="Connect"
					value={`${node.fqdn}:${draft.port}`}
				/>
				<DetailRow
					label="Resources"
					value={`${draft.cpuCores} cores · ${formatBytes(draft.memGb * GiB)} RAM · ${formatBytes(draft.diskGb * GiB)} disk`}
				/>
				<DetailRow label="Port" value={`${draft.port}/${draft.protocol}`} />
			</DetailList>

			{variables.length > 0 ? (
				<div className="space-y-2">
					<Eyebrow>{"// egg settings"}</Eyebrow>
					<DetailList>
						{variables.map((variable) => (
							<DetailRow
								key={variable.id}
								label={variable.name}
								value={
									variable.access === "secret"
										? draft.values[variable.envVariable]
											? "••••••••"
											: "Not set"
										: draft.values[variable.envVariable] || "—"
								}
							/>
						))}
					</DetailList>
				</div>
			) : null}
		</div>
	);
}
