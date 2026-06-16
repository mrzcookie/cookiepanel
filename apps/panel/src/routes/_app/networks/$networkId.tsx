import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ErrorScreen } from "@/components/layout/error-screen";
import { IsolatedBadge } from "@/components/networks/isolated-badge";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { PageHeader } from "@/components/shared/page-header";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import type { NetworkRow } from "@/lib/domain/networks";
import { serverStatus } from "@/lib/status";
import {
	attachServer,
	deleteNetwork,
	detachServer,
	renameNetwork,
	useAttachableServers,
	useAttachedServers,
	useNetwork,
} from "@/lib/stores/networks-store";

export const Route = createFileRoute("/_app/networks/$networkId")({
	component: NetworkDetail,
});

function NetworkDetail() {
	const { networkId } = Route.useParams();
	const network = useNetwork(networkId);

	if (!network) {
		return (
			<ErrorScreen
				action={
					<Button asChild size="sm" variant="outline">
						<Link to="/networks">Back to networks</Link>
					</Button>
				}
				className="min-h-[70vh]"
				code="404"
				description="It may have been removed, or you followed an old link."
				title="Network not found"
				tone="muted"
			/>
		);
	}

	return <NetworkManage network={network} />;
}

function NetworkManage({ network }: { network: NetworkRow }) {
	const navigate = Route.useNavigate();
	const [renameOpen, setRenameOpen] = useState(false);
	const editable = network.name !== "bridge";

	function remove() {
		deleteNetwork(network.id);
		toast.success(`Deleted “${network.name}”.`);
		navigate({ to: "/networks" });
	}

	return (
		<>
			<PageHeader
				actions={
					editable ? (
						<>
							<Button
								onClick={() => setRenameOpen(true)}
								size="sm"
								variant="outline"
							>
								Rename
							</Button>
							<Button onClick={remove} size="sm" variant="destructive">
								Delete
							</Button>
						</>
					) : null
				}
				back={{ label: "Networks", to: "/networks" }}
				description={`${network.driver} · ${network.nodeName}`}
				title={
					<span className="flex items-center gap-2">
						{network.name}
						{network.internal ? <IsolatedBadge /> : null}
					</span>
				}
			/>

			<div className="grid items-start gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Configuration</CardTitle>
						<CardDescription>
							How this network is addressed on {network.nodeName}.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<DetailList>
							<DetailRow label="Node" value={network.nodeName} />
							<DetailRow label="Driver" value={network.driver} />
							<DetailRow
								copyable={Boolean(network.subnet)}
								label="Subnet"
								value={network.subnet ?? "Auto"}
							/>
							<DetailRow
								copyable={Boolean(network.gateway)}
								label="Gateway"
								value={network.gateway ?? "—"}
							/>
						</DetailList>
					</CardContent>
				</Card>

				<NetworkServers network={network} />
			</div>

			<RenameNetworkDialog
				network={network}
				onOpenChange={setRenameOpen}
				open={renameOpen}
			/>
		</>
	);
}

function NetworkServers({ network }: { network: NetworkRow }) {
	const attached = useAttachedServers(network);
	const attachable = useAttachableServers(network);
	const [toAttach, setToAttach] = useState("");

	function attach() {
		if (!toAttach) {
			return;
		}
		attachServer(network.id, toAttach);
		setToAttach("");
		toast.success("Server attached.");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Servers</CardTitle>
				<CardDescription>
					Servers on {network.nodeName} that share this network.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{attached.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No servers are attached yet.
					</p>
				) : (
					<ul className="divide-y">
						{attached.map((server) => (
							<li
								className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
								key={server.id}
							>
								<div className="min-w-0">
									<div className="truncate font-medium text-sm">
										{server.name}
									</div>
									<div className="truncate text-muted-foreground text-xs">
										{server.templateName}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-3">
									<StatusIndicator status={serverStatus(server.state)} />
									<Button
										onClick={() => {
											detachServer(network.id, server.id);
											toast.success("Server detached.");
										}}
										size="sm"
										variant="ghost"
									>
										Detach
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}

				{attachable.length > 0 ? (
					<div className="flex items-center gap-2 border-t pt-3">
						<Select onValueChange={setToAttach} value={toAttach}>
							<SelectTrigger aria-label="Attach a server" className="w-full">
								<SelectValue placeholder="Attach a server…" />
							</SelectTrigger>
							<SelectContent>
								{attachable.map((server) => (
									<SelectItem key={server.id} value={server.id}>
										{server.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button disabled={!toAttach} onClick={attach}>
							Attach
						</Button>
					</div>
				) : (
					<p className="border-t pt-3 text-muted-foreground text-xs">
						Every server on {network.nodeName} is attached.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function RenameNetworkDialog({
	network,
	onOpenChange,
	open,
}: {
	network: NetworkRow;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [name, setName] = useState(network.name);

	// Re-seed the field each time the dialog opens (a controlled `open` doesn't
	// fire onOpenChange), so a cancelled edit doesn't linger on reopen.
	useEffect(() => {
		if (open) {
			setName(network.name);
		}
	}, [open, network.name]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						renameNetwork(network.id, name.trim());
						toast.success("Network renamed.");
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Rename network</DialogTitle>
						<DialogDescription>
							Give this network a name that's easy to recognize.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="network-name">Name</Label>
						<Input
							autoFocus
							id="network-name"
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
					</div>
					<DialogFooter>
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button disabled={name.trim() === ""} type="submit">
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
