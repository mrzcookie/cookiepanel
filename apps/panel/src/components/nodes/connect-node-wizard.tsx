import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/detail-list";
import { PageHeader } from "@/components/page-header";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerminalBlock } from "@/components/wizard/terminal-block";
import { WizardFrame } from "@/components/wizard/wizard-frame";
import type { WizardStep } from "@/components/wizard/wizard-stepper";
import { formatBytes } from "@/lib/format";
import { addNode, connectNode, removeNode, useNode } from "@/lib/nodes-store";
import { slugify } from "@/lib/slug";
import { nodeStatus } from "@/lib/status";
import type { NodeRow } from "@/lib/stubs";
import { cn } from "@/lib/utils";

const STEPS: WizardStep[] = [
	{ id: "configure", label: "Configure" },
	{ id: "install", label: "Install" },
	{ id: "connect", label: "Connect" },
];

type Mode = "managed" | "own";

// A node is reachable at a CookiePanel-minted subdomain or an operator-owned
// FQDN. We mirror the real shape: a freshly created node is a hostname allowlist
// check away from a single-use install command.
const HOSTNAME =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function bootstrapToken() {
	return `cpb_${crypto.randomUUID().replace(/-/g, "")}`;
}

// The connect-a-node wizard. Configure (name + reachability) mints a pending
// node row + a single-use bootstrap token; Install hands over the one-line
// command; Connect watches the (simulated) first heartbeat flip the node online.
export function ConnectNodeWizard() {
	const navigate = useNavigate();
	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [mode, setMode] = useState<Mode>("managed");
	const [fqdn, setFqdn] = useState("");
	const [port, setPort] = useState("8443");
	const [created, setCreated] = useState<{
		id: string;
		command: string;
	} | null>(null);

	const node = useNode(created?.id ?? "");
	const connected = step === 2 && node?.status === "online";

	// On the Connect step, stand in for the daemon's first heartbeat: after a
	// short delay the pending node flips online and its hardware appears. Cleared
	// if the operator cancels or leaves the step.
	useEffect(() => {
		if (step !== 2 || !created) {
			return;
		}
		const timer = setTimeout(() => connectNode(created.id), 3500);
		return () => clearTimeout(timer);
	}, [step, created]);

	const slug = slugify(name);
	const subdomain = `${slug || "your-node"}.nodes.cookiepanel.app`;
	const portNum = Number(port);
	const nameValid = name.trim().length >= 2 && slug.length > 0;
	const ownValid =
		HOSTNAME.test(fqdn.trim().toLowerCase()) &&
		Number.isInteger(portNum) &&
		portNum >= 1 &&
		portNum <= 65535;
	const configureValid = nameValid && (mode === "managed" || ownValid);

	function generate() {
		if (!configureValid) {
			return;
		}
		const resolvedFqdn =
			mode === "managed"
				? `${slug}.nodes.cookiepanel.app`
				: fqdn.trim().toLowerCase();
		const fresh = addNode({
			name,
			fqdn: resolvedFqdn,
			daemonPort: mode === "managed" ? 8443 : portNum,
			managed: mode === "managed",
		});
		const command = `curl -fsSL https://get.cookiepanel.app/install.sh | sudo bash -s -- --token ${bootstrapToken()}`;
		setCreated({ id: fresh.id, command });
		setStep(1);
	}

	// Backing out before anything has connected discards the pending node so the
	// next Continue mints a fresh single-use token.
	function backToConfigure() {
		if (created) {
			removeNode(created.id);
			setCreated(null);
		}
		setStep(0);
	}

	function cancelSetup() {
		if (created) {
			removeNode(created.id);
		}
		toast.info("Stopped connecting the node.");
		navigate({ to: "/nodes" });
	}

	function connectAnother() {
		setCreated(null);
		setName("");
		setMode("managed");
		setFqdn("");
		setPort("8443");
		setStep(0);
	}

	const heading =
		step === 0
			? {
					title: "Name your node",
					description:
						"A friendly name for this box, and how the panel reaches it. You can rename it later.",
				}
			: step === 1
				? {
						title: "Run this on your box",
						description:
							"Open a terminal on the box as root and paste this. The command works once.",
					}
				: connected
					? {
							title: "Connected",
							description: `${name || "Your node"} is online and ready to run servers.`,
						}
					: {
							title: "Waiting for your box",
							description:
								"Run the command, then leave this open. Hardware and live usage appear once the daemon reports in.",
						};

	const status =
		step === 2
			? connected
				? "Node connected."
				: "Waiting for the daemon to report in."
			: undefined;

	let footer: ReactNode;
	if (step === 0) {
		footer = (
			<>
				<Button asChild variant="ghost">
					<Link to="/nodes">Cancel</Link>
				</Button>
				<Button
					className="ml-auto"
					disabled={!configureValid}
					onClick={generate}
				>
					Continue
				</Button>
			</>
		);
	} else if (step === 1) {
		footer = (
			<>
				<Button onClick={backToConfigure} variant="ghost">
					Back
				</Button>
				<Button className="ml-auto" onClick={() => setStep(2)}>
					I've run it
				</Button>
			</>
		);
	} else if (connected && created) {
		footer = (
			<>
				<Button asChild variant="ghost">
					<Link to="/nodes">All nodes</Link>
				</Button>
				<Button className="ml-auto" onClick={connectAnother} variant="outline">
					Connect another
				</Button>
				<Button asChild>
					<Link params={{ nodeId: created.id }} to="/nodes/$nodeId">
						Go to node
					</Link>
				</Button>
			</>
		);
	} else {
		footer = (
			<Button onClick={cancelSetup} variant="ghost">
				Cancel setup
			</Button>
		);
	}

	return (
		<>
			<Link
				className="-mb-2 inline-flex items-center gap-1 font-mono text-muted-foreground text-xs uppercase tracking-wider transition-colors hover:text-foreground"
				to="/nodes"
			>
				<ChevronLeft className="size-4" />
				Nodes
			</Link>

			<PageHeader
				description="Pair a Linux box you own with CookiePanel. Name it, run one command on it, and it joins your fleet."
				eyebrow="connect a node"
				title="Connect a node"
			/>

			<WizardFrame
				current={step}
				footer={footer}
				status={status}
				stepDescription={heading.description}
				stepHeading={heading.title}
				steps={STEPS}
			>
				{step === 0 ? (
					<ConfigureStep
						fqdn={fqdn}
						mode={mode}
						name={name}
						onFqdn={setFqdn}
						onMode={setMode}
						onName={setName}
						onPort={setPort}
						port={port}
						subdomain={subdomain}
					/>
				) : null}
				{step === 1 && node ? (
					<InstallStep
						command={created?.command ?? ""}
						mode={mode}
						name={name}
						node={node}
					/>
				) : null}
				{step === 2 ? (
					<ConnectStep
						command={created?.command ?? ""}
						connected={Boolean(connected)}
						node={node}
					/>
				) : null}
			</WizardFrame>
		</>
	);
}

function ConfigureStep({
	fqdn,
	mode,
	name,
	onFqdn,
	onMode,
	onName,
	onPort,
	port,
	subdomain,
}: {
	fqdn: string;
	mode: Mode;
	name: string;
	onFqdn: (value: string) => void;
	onMode: (mode: Mode) => void;
	onName: (value: string) => void;
	onPort: (value: string) => void;
	port: string;
	subdomain: string;
}) {
	const nameInvalid =
		name.trim().length > 0 && (name.trim().length < 2 || slugify(name) === "");
	const fqdnInvalid =
		fqdn.trim().length > 0 && !HOSTNAME.test(fqdn.trim().toLowerCase());
	return (
		<div className="max-w-xl space-y-6">
			<div className="grid gap-2">
				<Label htmlFor="node-name">Node name</Label>
				<Input
					aria-describedby="node-name-msg"
					aria-invalid={nameInvalid || undefined}
					id="node-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="game-box-eu"
					value={name}
				/>
				<p
					className={cn(
						"text-xs",
						nameInvalid ? "text-destructive" : "text-muted-foreground"
					)}
					id="node-name-msg"
				>
					{nameInvalid
						? "Use at least 2 characters."
						: "Shown across your fleet."}
				</p>
			</div>

			<div className="space-y-2.5">
				<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{"// reachability"}
				</p>
				<fieldset className="grid gap-3 sm:grid-cols-2">
					<legend className="sr-only">How the panel reaches this node</legend>
					<ModeTile
						body="Easiest option. We point a subdomain at this box for you."
						current={mode}
						eyebrow="managed"
						onSelect={onMode}
						title="CookiePanel subdomain"
						value="managed"
					/>
					<ModeTile
						body="Point a domain you control at this box, then tell us where."
						current={mode}
						eyebrow="your domain"
						onSelect={onMode}
						title="Your own domain"
						value="own"
					/>
				</fieldset>
			</div>

			{mode === "managed" ? (
				<div className="flex items-baseline justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
					<span className="shrink-0 text-muted-foreground text-xs">
						Reachable at
					</span>
					<span className="min-w-0 truncate font-mono text-sm">
						{subdomain}
					</span>
				</div>
			) : (
				<div className="grid gap-4 sm:grid-cols-[1fr_auto]">
					<div className="grid gap-2">
						<Label htmlFor="node-fqdn">Daemon address</Label>
						<Input
							aria-describedby="node-fqdn-msg"
							aria-invalid={fqdnInvalid || undefined}
							className="font-mono text-sm"
							id="node-fqdn"
							inputMode="url"
							onChange={(event) => onFqdn(event.target.value)}
							placeholder="node3.gamebox.example.com"
							value={fqdn}
						/>
						{fqdnInvalid ? (
							<p className="text-destructive text-xs" id="node-fqdn-msg">
								Enter a full hostname, like node3.example.com.
							</p>
						) : null}
					</div>
					<div className="grid gap-2">
						<Label htmlFor="node-port">Daemon port</Label>
						<Input
							className="w-28 tabular-nums"
							id="node-port"
							inputMode="numeric"
							max={65535}
							min={1}
							onChange={(event) => onPort(event.target.value)}
							type="number"
							value={port}
						/>
					</div>
				</div>
			)}
		</div>
	);
}

function ModeTile({
	body,
	current,
	eyebrow,
	onSelect,
	title,
	value,
}: {
	body: string;
	current: Mode;
	eyebrow: string;
	onSelect: (mode: Mode) => void;
	title: string;
	value: Mode;
}) {
	const checked = current === value;
	return (
		<label
			className={cn(
				"relative flex cursor-pointer flex-col gap-1 rounded-lg bg-card p-4 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-offset-2",
				checked
					? "ring-2 ring-primary"
					: "ring-1 ring-foreground/10 hover:bg-muted/40"
			)}
		>
			<input
				checked={checked}
				className="sr-only"
				name="reachability"
				onChange={() => onSelect(value)}
				type="radio"
				value={value}
			/>
			<span className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
				{`// ${eyebrow}`}
			</span>
			<span className="font-medium text-sm">{title}</span>
			<span className="text-muted-foreground text-xs">{body}</span>
		</label>
	);
}

function InstallStep({
	command,
	mode,
	name,
	node,
}: {
	command: string;
	mode: Mode;
	name: string;
	node: NodeRow;
}) {
	return (
		<div className="max-w-2xl space-y-5">
			<p className="text-muted-foreground text-sm">
				Paste this into a root shell on the box you want to connect.
			</p>
			<TerminalBlock command={command} />
			<details className="text-sm">
				<summary className="cursor-pointer font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
					{"// what this does"}
				</summary>
				<ul className="mt-2 space-y-1 text-muted-foreground">
					<li>Installs cookied, the small agent that runs your servers.</li>
					<li>Registers this box with your account using a one-time token.</li>
					<li>
						Starts it reporting status back. Nothing else on the box is touched.
					</li>
				</ul>
			</details>
			<DetailList>
				<DetailRow label="Name" value={name} />
				<DetailRow label="Address" value={`${node.fqdn}:${node.daemonPort}`} />
				<DetailRow
					label="Reachability"
					value={
						mode === "managed" ? "CookiePanel subdomain" : "Your own domain"
					}
				/>
			</DetailList>
		</div>
	);
}

function ConnectStep({
	command,
	connected,
	node,
}: {
	command: string;
	connected: boolean;
	node: NodeRow | undefined;
}) {
	if (connected && node) {
		return (
			<div className="max-w-2xl space-y-5">
				<div className="flex items-center gap-3 rounded-lg border border-ok/40 bg-ok-wash/40 px-4 py-3">
					<StatusIndicator live status={nodeStatus("online")} />
					<p className="text-sm">{node.name} is online and reporting in.</p>
				</div>
				<DetailList>
					<DetailRow
						copyable
						label="Address"
						value={`${node.fqdn}:${node.daemonPort}`}
					/>
					<DetailRow label="Public IP" value={node.publicIp ?? "—"} />
					<DetailRow
						label="System"
						value={node.os ? `${node.os} · ${node.arch}` : "—"}
					/>
					<DetailRow
						label="CPU"
						value={node.cpuCores != null ? `${node.cpuCores} cores` : "—"}
					/>
					<DetailRow
						label="Memory"
						value={
							node.memTotalBytes != null ? formatBytes(node.memTotalBytes) : "—"
						}
					/>
					<DetailRow
						label="Daemon"
						value={node.daemonVersion ? `cookied ${node.daemonVersion}` : "—"}
					/>
				</DetailList>
			</div>
		);
	}

	return (
		<div className="max-w-2xl space-y-5">
			<div className="flex items-center gap-3">
				<StatusIndicator status={nodeStatus("pending")} />
				<p className="text-muted-foreground text-sm">
					Waiting for the daemon to report in. Hardware and live usage appear
					here once it does.
				</p>
			</div>
			<p className="text-muted-foreground text-xs">
				This usually takes a few seconds after the command finishes.
			</p>
			<div className="space-y-2">
				<p className="text-muted-foreground text-xs">
					Haven't run it yet? Copy the command again.
				</p>
				<TerminalBlock command={command} />
			</div>
		</div>
	);
}
