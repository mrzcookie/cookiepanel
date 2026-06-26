import { Link } from "@tanstack/react-router";
import { Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DeployVariableField } from "@/components/servers/deploy-variable-field";
import { StatusIndicator } from "@/components/shared/status-indicator";
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
import { capacityLabel } from "@/lib/domain/deploy";
import { deployVariables, type Egg } from "@/lib/domain/eggs";
import { useNodes } from "@/lib/node-queries";
import { nodeStatus } from "@/lib/status";

/** "Use egg": pick a node, name the server, fill in settings, deploy. */
export function UseEggDialog({ egg }: { egg: Egg }) {
	const nodes = useNodes();
	const [open, setOpen] = useState(false);
	const [nodeId, setNodeId] = useState("");
	const [name, setName] = useState("");
	const [values, setValues] = useState<Record<string, string>>({});
	const [runtime, setRuntime] = useState(
		() => egg.images.find((image) => image.isDefault)?.label ?? ""
	);

	const variables = deployVariables(egg);
	// A pending or offline node can't accept a deploy: shown but not selectable.
	const selectableNodes = nodes.filter(
		(node) => node.status === "online" || node.status === "unhealthy"
	);

	// Preselect when there's exactly one node you can actually deploy to.
	useEffect(() => {
		const only = selectableNodes[0];
		if (open && !nodeId && selectableNodes.length === 1 && only) {
			setNodeId(only.id);
		}
	}, [open, nodeId, selectableNodes]);

	function openChange(next: boolean) {
		setOpen(next);
		if (next) {
			const seed: Record<string, string> = {};
			for (const variable of variables) {
				seed[variable.envVariable] = variable.defaultValue ?? "";
			}
			setValues(seed);
			setName("");
			setNodeId("");
			setRuntime(egg.images.find((image) => image.isDefault)?.label ?? "");
		}
	}

	function deploy() {
		if (!nodeId) {
			toast.error("Choose a node.");
			return;
		}
		if (!name.trim()) {
			toast.error("Name your server.");
			return;
		}
		const node = nodes.find((candidate) => candidate.id === nodeId);
		toast.success(
			`Setting up “${name.trim()}” on ${node?.name ?? "the node"}.`
		);
		setOpen(false);
	}

	const hasNodes = nodes.length > 0;

	return (
		<Dialog onOpenChange={openChange} open={open}>
			<DialogTrigger asChild>
				<Button>
					<Rocket className="size-4" /> Use egg
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Set up {egg.name}</DialogTitle>
					<DialogDescription>
						Pick a node and a few settings. We'll install and start it for you.
					</DialogDescription>
				</DialogHeader>

				{hasNodes ? (
					<form
						onSubmit={(event) => {
							event.preventDefault();
							deploy();
						}}
					>
						<div className="grid gap-4 py-4">
							<div className="grid gap-2">
								<Label htmlFor="use-node">Node</Label>
								<Select onValueChange={setNodeId} value={nodeId}>
									<SelectTrigger className="h-auto w-full" id="use-node">
										<SelectValue placeholder="Choose a node" />
									</SelectTrigger>
									<SelectContent>
										{nodes.map((node) => {
											const capacity = capacityLabel(node);
											const deployable =
												node.status === "online" || node.status === "unhealthy";
											return (
												<SelectItem
													disabled={!deployable}
													key={node.id}
													value={node.id}
												>
													<div className="flex flex-col gap-0.5">
														<div className="flex items-center gap-2">
															<span>{node.name}</span>
															<StatusIndicator
																status={nodeStatus(node.status)}
															/>
														</div>
														{capacity ? (
															<span className="text-muted-foreground text-xs tabular-nums">
																{capacity}
															</span>
														) : null}
													</div>
												</SelectItem>
											);
										})}
									</SelectContent>
								</Select>
							</div>

							<div className="grid gap-2">
								<Label htmlFor="use-name">Server name</Label>
								<Input
									id="use-name"
									onChange={(event) => setName(event.target.value)}
									placeholder="survival-smp"
									value={name}
								/>
							</div>

							{egg.images.length > 1 ? (
								<div className="grid gap-2">
									<Label htmlFor="use-runtime">Runtime</Label>
									<Select onValueChange={setRuntime} value={runtime}>
										<SelectTrigger className="w-full" id="use-runtime">
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
								<fieldset className="grid gap-4">
									<legend className="mb-1 font-medium text-sm">
										Egg settings
									</legend>
									{variables.map((variable) => (
										<DeployVariableField
											key={variable.id}
											onChange={(value) =>
												setValues((prev) => ({
													...prev,
													[variable.envVariable]: value,
												}))
											}
											value={values[variable.envVariable] ?? ""}
											variable={variable}
										/>
									))}
								</fieldset>
							) : null}
						</div>

						<DialogFooter>
							<Button
								onClick={() => setOpen(false)}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button type="submit">Create server</Button>
						</DialogFooter>
					</form>
				) : (
					<>
						<div className="grid gap-3 py-4 text-sm">
							<p className="text-muted-foreground">
								You need a node before you can run a server.
							</p>
							<Button asChild size="sm" variant="outline">
								<Link to="/nodes">Add a node</Link>
							</Button>
						</div>
						<DialogFooter>
							<Button onClick={() => setOpen(false)} variant="outline">
								Close
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
