import { useNavigate } from "@tanstack/react-router";
import {
	HardDrive,
	LayoutTemplate,
	Network,
	Plus,
	SearchIcon,
	Server,
	UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { useEggs } from "@/lib/eggs-queries";
import { NAV } from "@/lib/nav";
import { useNetworks } from "@/lib/networking-queries";
import { useNodes } from "@/lib/node-queries";
import { useServers } from "@/lib/server-queries";

// A search-bar-styled launcher in the topbar that opens a command palette for
// jumping around the panel. It reads the live query hooks (nodes / servers /
// networks / eggs) so jump-to-entity rows reflect the real fleet.
export function CommandMenu() {
	const [open, setOpen] = useState(false);
	const [mod, setMod] = useState("Ctrl");
	const navigate = useNavigate();

	const nodes = useNodes();
	const servers = useServers();
	const networks = useNetworks();
	const eggs = useEggs();

	// Match the host's modifier key after mount (keeps SSR + first render stable).
	useEffect(() => {
		const isMac = /mac|iphone|ipad/i.test(
			navigator.platform || navigator.userAgent
		);
		if (isMac) {
			setMod("⌘");
		}
	}, []);

	// ⌘K / Ctrl+K toggles the menu from anywhere.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// Close, then run the action — so navigation lands after the dialog tears down.
	const run = useCallback((action: () => void) => {
		setOpen(false);
		action();
	}, []);

	return (
		<>
			<button
				className="inline-flex h-8 w-full max-w-xs items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				onClick={() => setOpen(true)}
				type="button"
			>
				<SearchIcon className="size-4 shrink-0" />
				<span className="truncate">Search…</span>
				<kbd className="ml-auto hidden shrink-0 items-center gap-0.5 font-mono text-[0.7rem] text-muted-foreground/80 tracking-wider sm:inline-flex">
					{mod}K
				</kbd>
			</button>

			<CommandDialog onOpenChange={setOpen} open={open}>
				<CommandInput placeholder="Search pages, actions, and your fleet…" />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>

					<CommandGroup heading="Go to">
						{NAV.map((item) => (
							<CommandItem
								key={item.to}
								onSelect={() => run(() => navigate({ to: item.to }))}
								value={`go ${item.title}`}
							>
								<item.icon />
								{item.title}
							</CommandItem>
						))}
						<CommandItem
							onSelect={() => run(() => navigate({ to: "/account" }))}
							value="go account"
						>
							<UserRound />
							Account
						</CommandItem>
					</CommandGroup>

					<CommandSeparator />

					<CommandGroup heading="Actions">
						<CommandItem
							onSelect={() => run(() => navigate({ to: "/nodes/new" }))}
							value="connect a node new"
						>
							<Plus />
							Connect a node
						</CommandItem>
						<CommandItem
							onSelect={() => run(() => navigate({ to: "/servers/new" }))}
							value="deploy a server new"
						>
							<Plus />
							Deploy a server
						</CommandItem>
						<CommandItem
							onSelect={() => run(() => navigate({ to: "/eggs/new" }))}
							value="new egg create"
						>
							<Plus />
							New egg
						</CommandItem>
					</CommandGroup>

					{nodes.length > 0 ? (
						<CommandGroup heading="Nodes">
							{nodes.map((node) => (
								<CommandItem
									key={node.id}
									onSelect={() =>
										run(() =>
											navigate({
												params: { nodeId: node.id },
												to: "/nodes/$nodeId",
											})
										)
									}
									value={`node ${node.name} ${node.fqdn}`}
								>
									<HardDrive />
									<span className="truncate">{node.name}</span>
									<span className="ml-auto truncate font-mono text-muted-foreground text-xs">
										{node.fqdn}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}

					{servers.length > 0 ? (
						<CommandGroup heading="Servers">
							{servers.map((server) => (
								<CommandItem
									key={server.id}
									onSelect={() =>
										run(() =>
											navigate({
												params: { serverId: server.id },
												to: "/servers/$serverId",
											})
										)
									}
									value={`server ${server.name} ${server.nodeName}`}
								>
									<Server />
									<span className="truncate">{server.name}</span>
									<span className="ml-auto truncate font-mono text-muted-foreground text-xs">
										{server.nodeName}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}

					{networks.length > 0 ? (
						<CommandGroup heading="Networks">
							{networks.map((network) => (
								<CommandItem
									key={network.id}
									onSelect={() =>
										run(() =>
											navigate({
												params: { networkId: network.id },
												to: "/networks/$networkId",
											})
										)
									}
									value={`network ${network.name}`}
								>
									<Network />
									<span className="truncate">{network.name}</span>
									<span className="ml-auto truncate font-mono text-muted-foreground text-xs">
										{network.driver}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}

					{eggs.length > 0 ? (
						<CommandGroup heading="Eggs">
							{eggs.map((egg) => (
								<CommandItem
									key={egg.id}
									onSelect={() =>
										run(() =>
											navigate({
												params: { eggId: egg.id },
												to: "/eggs/$eggId",
											})
										)
									}
									value={`egg ${egg.name} ${egg.category}`}
								>
									<LayoutTemplate />
									<span className="truncate">{egg.name}</span>
									<span className="ml-auto truncate font-mono text-muted-foreground text-xs">
										{egg.category}
									</span>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}
				</CommandList>
			</CommandDialog>
		</>
	);
}
