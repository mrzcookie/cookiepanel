import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
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
import type { NetworkDriver } from "@/lib/domain/networks";
import type { NodeRow } from "@/lib/domain/nodes";
import { createNetwork, invalidateNetworks } from "@/lib/networking-queries";

const DRIVERS: NetworkDriver[] = ["bridge", "macvlan", "ipvlan"];

// Shared create-network dialog. On a node's networking tab pass `node` (the node
// is fixed, so the node picker is omitted); on the org-wide /networks list pass
// `nodes` and the operator picks one.
export function CreateNetworkDialog({
	node,
	nodes,
	onOpenChange,
	open,
}: {
	node?: NodeRow;
	nodes?: NodeRow[];
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: {
			driver: "bridge" as NetworkDriver,
			gateway: "",
			name: "",
			nodeId: node?.id ?? "",
			subnet: "",
		},
		onSubmit: async ({ value, formApi }) => {
			const target =
				node ?? nodes?.find((candidate) => candidate.id === value.nodeId);
			if (!target) {
				return;
			}
			try {
				await createNetwork({
					nodeId: target.id,
					name: value.name.trim(),
					driver: value.driver,
					subnet: value.subnet.trim() || undefined,
					gateway: value.gateway.trim() || undefined,
				});
				await invalidateNetworks(queryClient);
				toast.success(`Created “${value.name.trim()}”.`);
				onOpenChange(false);
				formApi.reset();
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't create the network."
				);
			}
		},
	});

	return (
		<Dialog
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					form.reset();
				}
			}}
			open={open}
		>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Create a network</DialogTitle>
						<DialogDescription>
							{node
								? `Add a network on ${node.name} for servers to share.`
								: "Add a network on one of your nodes for servers to share."}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						{node ? null : (
							<form.Field name="nodeId">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Node</Label>
										<Select
											onValueChange={field.handleChange}
											value={field.state.value}
										>
											<SelectTrigger className="w-full" id={field.name}>
												<SelectValue placeholder="Select a node" />
											</SelectTrigger>
											<SelectContent>
												{(nodes ?? []).map((option) => (
													<SelectItem key={option.id} value={option.id}>
														{option.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
						)}
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Name</Label>
									<Input
										id={field.name}
										name={field.name}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder="game-lan"
										value={field.state.value}
									/>
								</div>
							)}
						</form.Field>
						<form.Field name="driver">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Driver</Label>
									<Select
										onValueChange={(value) =>
											field.handleChange(value as NetworkDriver)
										}
										value={field.state.value}
									>
										<SelectTrigger className="w-full" id={field.name}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DRIVERS.map((option) => (
												<SelectItem key={option} value={option}>
													{option}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>
						<div className="flex flex-col gap-4 sm:flex-row">
							<form.Field name="subnet">
								{(field) => (
									<div className="grid flex-1 gap-2">
										<Label htmlFor={field.name}>Subnet</Label>
										<Input
											className="font-mono text-xs"
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="172.20.0.0/16"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
							<form.Field name="gateway">
								{(field) => (
									<div className="grid flex-1 gap-2">
										<Label htmlFor={field.name}>Gateway</Label>
										<Input
											className="font-mono text-xs"
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="172.20.0.1"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
						</div>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<form.Subscribe
							selector={(state) =>
								state.values.name.trim() !== "" &&
								(Boolean(node) || state.values.nodeId !== "")
							}
						>
							{(canCreate) => (
								<Button disabled={!canCreate} type="submit">
									Create network
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
