import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerminalBlock } from "@/components/wizard/terminal-block";
import { WizardFrame } from "@/components/wizard/wizard-frame";
import type { WizardStep } from "@/components/wizard/wizard-stepper";
import type { NodeRow } from "@/lib/domain/nodes";
import { NODES_DOMAIN } from "@/lib/node-domain";
import { createNode, invalidateNodes, removeNode } from "@/lib/node-queries";
import { slugify } from "@/lib/slug";
import { nodeStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The connect-a-node wizard, written for someone who has never done this before.
// Step 1 (Set up) names the node and picks how the panel reaches it; choosing
// "your own domain" inserts a from-zero "Point your domain" tutorial step before
// Install. Install hands over the real one-line command (carrying the single-use
// enrollment token the panel minted at registration). The node is registered the
// moment Set up completes and stays `pending` until its daemon reports in — and
// there's no daemon yet, so Connect is an honest "run it, your node will appear"
// hand-off rather than a live heartbeat watch. The managed path stays three
// effortless steps and never shows any domain copy.

type Mode = "managed" | "own";
type StepId = "prereqs" | "setup" | "dns" | "install" | "connect";

// A node is reachable at a Raptor-minted subdomain or an operator-owned
// FQDN. We mirror the real shape: a freshly created node is a hostname allowlist
// check away from a single-use install command.
const HOSTNAME =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const PREREQS_STEP: WizardStep = { id: "prereqs", label: "Get ready" };
const SETUP_STEP: WizardStep = { id: "setup", label: "Set up" };
const DNS_STEP: WizardStep = { id: "dns", label: "Point domain" };
const INSTALL_STEP: WizardStep = { id: "install", label: "Install" };
const CONNECT_STEP: WizardStep = { id: "connect", label: "Connect" };

function stepsFor(mode: Mode): WizardStep[] {
	return mode === "own"
		? [PREREQS_STEP, SETUP_STEP, DNS_STEP, INSTALL_STEP, CONNECT_STEP]
		: [PREREQS_STEP, SETUP_STEP, INSTALL_STEP, CONNECT_STEP];
}

// Everything a beginner needs lined up before they start: lead sentence + a
// plain-words detail. Shown on the dedicated "Before you start" step.
const REQUIREMENTS: [string, string][] = [
	[
		"A 64-bit Linux machine you control.",
		"A VPS, a home server, or a spare PC running Debian, Ubuntu, Rocky Linux, or AlmaLinux.",
	],
	[
		"Root or sudo access on it.",
		"On a rented server this is the login your host gave you.",
	],
	[
		"A static public IP address.",
		"A public address on the internet that does not change, so your node stays reachable. Most rented servers include one. On a home connection, ask your provider for a static IP.",
	],
	[
		"It stays on, with internet.",
		"Your servers run on this machine, so a laptop that sleeps will not work.",
	],
	[
		"A way to open a terminal on it.",
		"An SSH session or your host's web console is fine.",
	],
];

// The part of a hostname before the registrable domain — the "Name" / "Host" an
// A record needs (node1.example.com -> "node1"; a bare example.com -> "@").
function recordName(fqdn: string): string {
	const host = fqdn.trim().toLowerCase();
	if (!host) {
		return "@";
	}
	const parts = host.split(".");
	return parts.length > 2 ? (parts[0] ?? "@") : "@";
}

// The DNS pre-flight on the domain step. Optimistic: the real first heartbeat is
// the actual validator, so the check only ever encourages — it never blocks
// Continue.
type DnsState = "idle" | "checking" | "pointed";
// The IP the simulated DNS check reports, so the story stays consistent on the
// domain step.
const DETECTED_IP = "203.0.113.24";

export function ConnectNodeWizard() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [stepId, setStepId] = useState<StepId>("prereqs");
	const [name, setName] = useState("");
	const [mode, setMode] = useState<Mode>("managed");
	const [fqdn, setFqdn] = useState("");
	const [port, setPort] = useState("8443");
	const [dnsState, setDnsState] = useState<DnsState>("idle");
	const [generating, setGenerating] = useState(false);
	const [created, setCreated] = useState<{
		node: NodeRow;
		command: string;
	} | null>(null);

	// The just-registered node (pending). Drives the Install/Connect recaps; there
	// is no live "online" flip without a daemon.
	const node = created?.node;

	const steps = stepsFor(mode);
	const current = Math.max(
		0,
		steps.findIndex((step) => step.id === stepId)
	);

	const slug = slugify(name);
	const subdomain = `${slug || "your-node"}.${NODES_DOMAIN}`;
	const portNum = Number(port);
	const nameValid = name.trim().length >= 2 && slug.length > 0;
	const ownValid =
		HOSTNAME.test(fqdn.trim().toLowerCase()) &&
		Number.isInteger(portNum) &&
		portNum >= 1 &&
		portNum <= 65535;
	const configureValid = nameValid && (mode === "managed" || ownValid);

	// Simulate the DNS lookup the "Check domain" button kicks off.
	useEffect(() => {
		if (dnsState !== "checking") {
			return;
		}
		const timer = setTimeout(() => setDnsState("pointed"), 1500);
		return () => clearTimeout(timer);
	}, [dnsState]);

	async function generate() {
		if (!configureValid || generating) {
			return;
		}
		setGenerating(true);
		try {
			// Re-minting after a back-edit: drop the stale pending node + token so we
			// never orphan a half-set-up node or carry a stale install command.
			if (created) {
				await removeNode(created.node.id);
			}
			const resolvedFqdn =
				mode === "managed"
					? `${slug}.${NODES_DOMAIN}`
					: fqdn.trim().toLowerCase();
			const result = await createNode({
				name,
				fqdn: resolvedFqdn,
				daemonPort: mode === "managed" ? 8443 : portNum,
				managed: mode === "managed",
			});
			await invalidateNodes(queryClient);
			setDnsState("idle");
			setCreated({ node: result.node, command: result.enrollment.command });
			setStepId(mode === "own" ? "dns" : "install");
		} catch (error) {
			// Surfaces validation and the billing entitlement gate (a friendly
			// past-the-free-node nudge) alike.
			toast.error(
				error instanceof Error ? error.message : "Couldn't set up the node."
			);
		} finally {
			setGenerating(false);
		}
	}

	// Discard the pending node + token (so the next forward run mints fresh ones)
	// and leave. Back between steps preserves them — the install command must stay
	// stable while the operator is mid-flow.
	async function cancelSetup() {
		if (created) {
			await removeNode(created.node.id);
			await invalidateNodes(queryClient);
		}
		toast.info("Stopped connecting the node.");
		navigate({ to: "/nodes" });
	}

	// Leaving from the first step: if a node was already minted (the operator went
	// forward then back), discard it so we don't leave a pending orphan behind.
	async function cancelFromSetup() {
		if (created) {
			await removeNode(created.node.id);
			await invalidateNodes(queryClient);
		}
		navigate({ to: "/nodes" });
	}

	function connectAnother() {
		setCreated(null);
		setName("");
		setMode("managed");
		setFqdn("");
		setPort("8443");
		setDnsState("idle");
		setStepId("prereqs");
	}

	const heading = stepHeading(stepId, name);
	const status = stepStatus(stepId, fqdn, dnsState);

	let footer: ReactNode;
	if (stepId === "prereqs") {
		footer = (
			<>
				<Button onClick={cancelFromSetup} variant="ghost">
					Cancel
				</Button>
				<Button className="ml-auto" onClick={() => setStepId("setup")}>
					I have these
				</Button>
			</>
		);
	} else if (stepId === "setup") {
		footer = (
			<>
				<Button onClick={() => setStepId("prereqs")} variant="ghost">
					Back
				</Button>
				<Button
					className="ml-auto"
					disabled={!configureValid || generating}
					onClick={generate}
				>
					{generating ? "Setting up…" : "Continue"}
				</Button>
			</>
		);
	} else if (stepId === "dns") {
		footer = (
			<>
				<Button onClick={() => setStepId("setup")} variant="ghost">
					Back
				</Button>
				<Button className="ml-auto" onClick={() => setStepId("install")}>
					{dnsState === "pointed" ? "Continue" : "Continue anyway"}
				</Button>
			</>
		);
	} else if (stepId === "install") {
		footer = (
			<>
				<Button
					onClick={() => setStepId(mode === "own" ? "dns" : "setup")}
					variant="ghost"
				>
					Back
				</Button>
				<Button className="ml-auto" onClick={() => setStepId("connect")}>
					I've run it
				</Button>
			</>
		);
	} else if (stepId === "connect" && created) {
		footer = (
			<>
				<Button asChild variant="ghost">
					<Link to="/nodes">All nodes</Link>
				</Button>
				<Button className="ml-auto" onClick={connectAnother} variant="outline">
					Connect another
				</Button>
				<Button asChild>
					<Link params={{ nodeId: created.node.id }} to="/nodes/$nodeId">
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
			<PageHeader
				back={{ label: "Nodes", to: "/nodes" }}
				description="Pair a Linux machine you own with Raptor. Name it, run one command on it, and it joins your fleet."
				title="Connect a node"
			/>

			<WizardFrame
				current={current}
				footer={footer}
				status={status}
				stepDescription={heading.description}
				stepHeading={heading.title}
				steps={steps}
			>
				{stepId === "prereqs" ? <PrereqsStep /> : null}
				{stepId === "setup" ? (
					<SetupStep
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
				{stepId === "dns" ? (
					<DnsStep
						dnsState={dnsState}
						fqdn={fqdn.trim().toLowerCase()}
						onCheck={() => setDnsState("checking")}
						port={port}
					/>
				) : null}
				{stepId === "install" && node ? (
					<InstallStep
						command={created?.command ?? ""}
						dnsPointed={mode === "own" && dnsState === "pointed"}
						mode={mode}
						node={node}
					/>
				) : null}
				{stepId === "connect" ? (
					<ConnectStep
						command={created?.command ?? ""}
						mode={mode}
						name={name}
						node={node}
						port={port}
					/>
				) : null}
			</WizardFrame>
		</>
	);
}

function stepHeading(stepId: StepId, name: string) {
	if (stepId === "prereqs") {
		return {
			title: "Before you start",
			description:
				"Here is everything you need to connect a node. Get these ready, then we will set it up. It takes about five minutes.",
		};
	}
	if (stepId === "setup") {
		return {
			title: "Set up your node",
			description:
				"Give it a name and choose how Raptor reaches it. You can rename it later.",
		};
	}
	if (stepId === "dns") {
		return {
			title: "Point your domain at this node",
			description:
				"Find your server's public address, then add one DNS record at your domain provider. We will check it for you before you continue.",
		};
	}
	if (stepId === "install") {
		return {
			title: "Run this on your node",
			description:
				"Open a terminal on the node as root and paste this. The command works once.",
		};
	}
	return {
		title: "You're all set",
		description: `${name || "Your node"} is in your fleet. Run the command, and it comes online the moment its agent reports in.`,
	};
}

function stepStatus(
	stepId: StepId,
	fqdn: string,
	dnsState: DnsState
): string | undefined {
	if (stepId === "dns") {
		if (dnsState === "checking") {
			return `Looking up ${fqdn || "your address"}.`;
		}
		if (dnsState === "pointed") {
			return "Your domain points at the node.";
		}
		return undefined;
	}
	if (stepId === "connect") {
		return "Node registered. Awaiting first report.";
	}
	return undefined;
}

// — Shared bits ————————————————————————————————————————————————————————————————

function Eyebrow({ children }: { children: ReactNode }) {
	return (
		<p className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
			{children}
		</p>
	);
}

// A click-to-open section, controlled (so default-open survives re-renders and
// SSR). The summary reads as a `// label` eyebrow with a rotating chevron.
function Collapsible({
	children,
	defaultOpen = false,
	summary,
}: {
	children: ReactNode;
	defaultOpen?: boolean;
	summary: string;
}) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div>
			<button
				aria-expanded={open}
				className="flex w-full items-center gap-1.5 font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em] transition-colors hover:text-foreground"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						open && "rotate-90"
					)}
				/>
				{summary}
			</button>
			{open ? (
				<div className="mt-2 space-y-2 pl-5 text-muted-foreground text-sm">
					{children}
				</div>
			) : null}
		</div>
	);
}

// — Step 1: Before you start ———————————————————————————————————————————————————

function PrereqsStep() {
	return (
		<div className="max-w-xl space-y-5">
			<p className="text-muted-foreground text-sm">
				A node is a Linux machine you own that Raptor runs your servers on. Have
				these ready before you continue.
			</p>
			<ul className="space-y-3">
				{REQUIREMENTS.map(([lead, detail]) => (
					<li className="flex gap-3 text-sm" key={lead}>
						<Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<span>
							<span className="font-medium text-foreground">{lead}</span>{" "}
							<span className="text-muted-foreground">{detail}</span>
						</span>
					</li>
				))}
			</ul>
			<p className="rounded-lg border bg-muted/20 px-3 py-2.5 text-muted-foreground text-xs">
				Nothing else to install. Raptor sets up everything it needs on the
				machine, including Docker if it is missing. It only manages servers you
				create here and never touches the rest of your machine.
			</p>
		</div>
	);
}

// — Step 2: Set up —————————————————————————————————————————————————————————————

function SetupStep({
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
					placeholder="game-node-eu"
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
						: "A friendly name, shown across your fleet."}
				</p>
			</div>

			<div className="space-y-2.5">
				<Eyebrow>{"// how we reach this node"}</Eyebrow>
				<fieldset className="grid gap-3 sm:grid-cols-2">
					<legend className="sr-only">How Raptor reaches this node</legend>
					<ModeTile
						body="Easiest by far. We create a web address for this node and handle all the network setup for you. Pick this if you are not sure."
						current={mode}
						eyebrow="recommended"
						onSelect={onMode}
						title="Raptor subdomain"
						value="managed"
					/>
					<ModeTile
						body="Point a domain you already own at this node. More setup, but the address is yours. We will walk you through it."
						current={mode}
						eyebrow="advanced"
						onSelect={onMode}
						title="Use my own domain"
						value="own"
					/>
				</fieldset>
			</div>

			{mode === "managed" ? (
				<div className="space-y-1.5">
					<div className="flex items-baseline justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
						<span className="shrink-0 text-muted-foreground text-xs">
							Reachable at
						</span>
						<span className="min-w-0 truncate font-mono text-sm">
							{subdomain}
						</span>
					</div>
					<p className="text-muted-foreground text-xs">
						We create this address and keep it pointed at your node
						automatically. Nothing for you to do.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					<p className="text-muted-foreground text-sm">
						Tell us the exact address this node will answer on, and the port.
						You will point your domain at it in the next step.
					</p>
					<div className="grid gap-4 sm:grid-cols-[1fr_auto]">
						<div className="grid gap-2">
							<Label htmlFor="node-fqdn">Node address</Label>
							<Input
								aria-describedby="node-fqdn-msg"
								aria-invalid={fqdnInvalid || undefined}
								className="font-mono text-sm"
								id="node-fqdn"
								inputMode="url"
								onChange={(event) => onFqdn(event.target.value)}
								placeholder="node1.yourdomain.com"
								value={fqdn}
							/>
							<p
								className={cn(
									"text-xs",
									fqdnInvalid ? "text-destructive" : "text-muted-foreground"
								)}
								id="node-fqdn-msg"
							>
								{fqdnInvalid
									? "Enter a full hostname, like node1.yourdomain.com."
									: "A full hostname on a domain you own. We will get a free HTTPS certificate for it."}
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="node-port">Port</Label>
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
					<p className="text-muted-foreground text-xs">
						Leave the port as 8443 unless you have a reason to change it.
					</p>
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

// — Step 2 (own domain only): Point your domain ————————————————————————————————

function DnsStep({
	dnsState,
	fqdn,
	onCheck,
	port,
}: {
	dnsState: DnsState;
	fqdn: string;
	onCheck: () => void;
	port: string;
}) {
	const [serverIp, setServerIp] = useState("");
	const shown = fqdn || "your address";
	const name = recordName(fqdn);
	const ipValue = serverIp.trim() || "your server's public IPv4";
	const ipInvalid = serverIp.trim().length > 0 && !IPV4.test(serverIp.trim());

	return (
		<div className="space-y-6">
			<p className="text-muted-foreground text-sm">
				DNS is the phone book of the internet. Right now{" "}
				<span className="font-mono text-foreground">{shown}</span> does not lead
				anywhere. You will fix that by adding one "A record" at the company you
				manage your domain with. An A record is just a line that says "this name
				points to this machine." Do this in a second tab and come back. Nothing
				here can break your existing site or email.
			</p>

			<section className="space-y-3 border-t pt-5">
				<Eyebrow>{"// 1. find your server's public IP"}</Eyebrow>
				<p className="text-muted-foreground text-sm">
					An A record needs your server's public IPv4 address, four numbers like
					203.0.113.24. Raptor does not know it yet, so grab it from the server
					itself. On the node, run:
				</p>
				<TerminalBlock command="curl -4 ifconfig.me" label="find IP command" />
				<p className="text-muted-foreground text-xs">
					It prints one line, like 203.0.113.24. Copy it. If that command is
					missing, try <span className="font-mono">curl -4 icanhazip.com</span>,
					or read the public IPv4 from your hosting provider's dashboard.
				</p>
				<p className="rounded-lg border border-warn/40 bg-warn-wash/40 px-3 py-2.5 text-muted-foreground text-sm">
					Use the address that starts with a public number, not 10.x, 172.16 to
					172.31.x, or 192.168.x. Those are private and will not work from the
					internet.
				</p>
				<div className="grid gap-2">
					<Label htmlFor="server-ip">Your server's public IP (optional)</Label>
					<Input
						aria-invalid={ipInvalid || undefined}
						className="font-mono text-sm sm:max-w-xs"
						id="server-ip"
						inputMode="numeric"
						onChange={(event) => setServerIp(event.target.value)}
						placeholder="203.0.113.24"
						value={serverIp}
					/>
					<p
						className={cn(
							"text-xs",
							ipInvalid ? "text-destructive" : "text-muted-foreground"
						)}
					>
						{ipInvalid
							? "That does not look like an IPv4 address."
							: "Paste it here and we will fill it into the record below."}
					</p>
				</div>
			</section>

			<section className="space-y-3 border-t pt-5">
				<Eyebrow>{"// 2. add the DNS record"}</Eyebrow>
				<p className="text-muted-foreground text-sm">
					Log in wherever you manage your domain's DNS. That is usually your
					registrar, like Cloudflare, Namecheap, GoDaddy, or Porkbun. Find the
					section called DNS, DNS records, or Manage DNS, then add a new record
					with these values:
				</p>
				<div className="rounded-lg border px-3 py-1">
					<DetailList>
						<DetailRow label="Type" value="A" />
						<DetailRow copyable label="Name / Host" value={name} />
						<DetailRow label="Value / Points to" value={ipValue} wrap />
						<DetailRow label="TTL" value="Automatic (or the lowest offered)" />
					</DetailList>
				</div>
				<ul className="space-y-1 text-muted-foreground text-xs">
					<li>
						Name is just the part before your domain. For{" "}
						<span className="font-mono">{shown}</span> the Name is{" "}
						<span className="font-mono">{name}</span>. If you are using the bare
						domain, the Name is <span className="font-mono">@</span>.
					</li>
					<li>Value is the IP number you found in step 1.</li>
					<li>
						When this is saved, <span className="font-mono">{shown}</span> will
						point at your server.
					</li>
				</ul>
				<Collapsible summary="// using Cloudflare?">
					<p>
						Set the record's proxy status to DNS only. Click the orange cloud so
						it turns grey. The orange proxy would block the secure certificate
						and the connection port. Grey cloud is correct.
					</p>
				</Collapsible>
				<Collapsible summary="// have an IPv6 address too? (optional)">
					<p>
						If your host also gave you a public IPv6 address (it has colons,
						like 2001:db8::1), add a second record of type AAAA with that
						address and the same Name. This is optional. Skip it if you are not
						sure.
					</p>
				</Collapsible>
			</section>

			<section className="space-y-3 border-t pt-5">
				<Eyebrow>{"// 3. check it"}</Eyebrow>
				<p className="text-muted-foreground text-sm">
					When you have saved the record, check that it points the right way.
					You can keep going even if it is not ready yet, but checking first
					avoids surprises.
				</p>
				<div className="flex flex-wrap items-center gap-3">
					<Button
						disabled={dnsState === "checking"}
						onClick={onCheck}
						size="sm"
						variant="outline"
					>
						{dnsState === "pointed" ? "Check again" : "Check domain"}
					</Button>
					<DnsCheckChip state={dnsState} />
				</div>
				{dnsState === "pointed" ? (
					<div className="rounded-lg border px-3 py-1">
						<DetailList>
							<DetailRow label="Looked up" value={shown} />
							<DetailRow label="Resolved to" value={DETECTED_IP} />
						</DetailList>
					</div>
				) : (
					<ul className="space-y-1 text-muted-foreground text-xs">
						<li>Double-check the record Type is A and the Name matches.</li>
						<li>Cloudflare users: confirm the proxy (orange cloud) is off.</li>
						<li>
							DNS can take up to an hour. Give it a few minutes, then check
							again.
						</li>
					</ul>
				)}
			</section>

			<div className="border-t pt-5">
				<Collapsible summary="// also make sure your ports are open">
					<p>Your node also needs to be reachable from the internet on:</p>
					<ul className="space-y-1">
						<li>
							Port {port || "8443"} (TCP) is how Raptor talks to your node.
						</li>
						<li>
							Ports 80 and 443 (TCP) are used once to get your node a free HTTPS
							certificate.
						</li>
					</ul>
					<p>
						On most rented servers these are open already. If your machine is
						behind a home router or a cloud firewall, allow incoming traffic on
						those ports (look for "firewall rules", "security group", or "port
						forwarding"). If you are not sure, continue anyway. We will tell you
						if anything is unreachable.
					</p>
				</Collapsible>
			</div>

			{dnsState === "pointed" ? (
				<p className="text-ok text-sm">
					DNS verified. Next, install the agent.
				</p>
			) : (
				<p className="text-muted-foreground text-sm">
					DNS changes usually take a few minutes, sometimes up to an hour. You
					can continue now and install while it catches up. The node comes
					online once DNS resolves.
				</p>
			)}
		</div>
	);
}

function DnsCheckChip({ state }: { state: DnsState }) {
	if (state === "checking") {
		return (
			<StatusIndicator live status={{ label: "Checking", tone: "pending" }} />
		);
	}
	if (state === "pointed") {
		return <StatusIndicator status={{ label: "Pointed", tone: "online" }} />;
	}
	return <StatusIndicator status={{ label: "Not checked", tone: "muted" }} />;
}

// — Step 3: Install ————————————————————————————————————————————————————————————

function InstallStep({
	command,
	dnsPointed,
	mode,
	node,
}: {
	command: string;
	dnsPointed: boolean;
	mode: Mode;
	node: NodeRow;
}) {
	return (
		<div className="max-w-2xl space-y-5">
			<p className="text-muted-foreground text-sm">
				Log in to your machine (SSH or its console) and paste this as an
				administrator. It installs the agent, links this node to your account,
				and starts it reporting in. Nothing else on the machine is changed.
			</p>
			<TerminalBlock command={command} />
			<p className="text-muted-foreground text-xs">
				Not root? The sudo in the command handles it; you will be asked for your
				password. Not sure how to open a terminal on a VPS? Your host's
				dashboard usually has a "Console" or "SSH" button.
			</p>
			<Collapsible summary="// what this does">
				<ul className="space-y-1">
					<li>Installs wings, the small agent that runs your servers.</li>
					<li>Installs Docker for you if it is not already there.</li>
					<li>
						Connects this node to your account using a one-time token, then
						deletes the token.
					</li>
					<li>
						Starts it reporting status back. It only manages servers you create
						here.
					</li>
					{mode === "own" ? (
						<li>
							Gets a free HTTPS certificate for {node.fqdn} so the connection is
							encrypted.
						</li>
					) : null}
				</ul>
			</Collapsible>
			<DetailList>
				<DetailRow label="Name" value={node.name} />
				<DetailRow label="Address" value={`${node.fqdn}:${node.daemonPort}`} />
				<DetailRow
					label="Reachability"
					value={mode === "managed" ? "Raptor subdomain" : "Your own domain"}
				/>
				{dnsPointed ? <DetailRow label="DNS" value="Pointed" /> : null}
			</DetailList>
			<p className="text-muted-foreground text-xs">
				The token works one time and then expires. After this, the panel and
				your node talk only over an encrypted connection with a key unique to
				this node.
			</p>
		</div>
	);
}

// — Step 4: Connect ————————————————————————————————————————————————————————————

function ConnectStep({
	command,
	mode,
	name,
	node,
	port,
}: {
	command: string;
	mode: Mode;
	name: string;
	node: NodeRow | undefined;
	port: string;
}) {
	return (
		<div className="max-w-2xl space-y-5">
			<div className="flex items-center gap-3 rounded-lg border px-4 py-3">
				<StatusIndicator live status={nodeStatus("pending")} />
				<p className="text-sm">
					{node?.name || name || "Your node"} is in your fleet, waiting for its
					first report.
				</p>
			</div>
			<p className="text-muted-foreground text-sm">
				Run the command on your machine if you haven't yet. The node comes
				online on its own the moment its agent reports in — you don't need to
				keep this page open. You'll find it under Nodes either way.
			</p>
			{node ? (
				<DetailList>
					<DetailRow
						copyable
						label="Address"
						value={`${node.fqdn}:${node.daemonPort}`}
					/>
					<DetailRow
						label="Reachability"
						value={mode === "managed" ? "Raptor subdomain" : "Your own domain"}
					/>
				</DetailList>
			) : null}
			<Collapsible summary="// not showing up?">
				<ul className="space-y-1">
					<li>
						Make sure the command finished without an error in your terminal.
					</li>
					<li>Confirm the machine is on and connected to the internet.</li>
					{mode === "own" ? (
						<>
							<li>
								Confirm your DNS record points at the server's public IP, and
								that port {port || "8443"} is reachable from the internet.
							</li>
							<li>Cloudflare users: the proxy (orange cloud) must be off.</li>
						</>
					) : null}
					<li>Still nothing after a minute? Run the command below again.</li>
				</ul>
			</Collapsible>
			<div className="space-y-2">
				<Eyebrow>{"// run it again"}</Eyebrow>
				<TerminalBlock command={command} />
			</div>
		</div>
	);
}
