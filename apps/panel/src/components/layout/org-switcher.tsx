import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	createOrg,
	type Org,
	setActiveOrg,
	useActiveOrg,
	useOrgs,
} from "@/lib/stores/orgs-store";
import { cn } from "@/lib/utils";

function OrgInitial({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-sm bg-primary font-bold font-mono text-[0.7rem] text-primary-foreground",
				className
			)}
		>
			{name.charAt(0).toUpperCase()}
		</span>
	);
}

export function OrgSwitcher() {
	const orgs = useOrgs();
	const active = useActiveOrg();
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						className="flex w-full items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left transition-colors hover:bg-muted aria-expanded:bg-muted group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0"
						type="button"
					>
						<OrgInitial name={active.name} />
						<span className="min-w-0 flex-1 truncate font-medium text-sm group-data-[collapsible=icon]:hidden">
							{active.name}
						</span>
						<ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
						<span className="sr-only">Switch organization</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-60">
					<DropdownMenuLabel className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						Organizations
					</DropdownMenuLabel>
					{orgs.map((org: Org) => (
						<DropdownMenuItem key={org.id} onClick={() => setActiveOrg(org.id)}>
							<OrgInitial name={org.name} />
							<span className="min-w-0 flex-1 truncate">{org.name}</span>
							{org.id === active.id ? (
								<Check className="size-4 shrink-0 text-primary" />
							) : null}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setCreateOpen(true)}>
						<Plus />
						Create organization
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<CreateOrgDialog onOpenChange={setCreateOpen} open={createOpen} />
		</>
	);
}

function CreateOrgDialog({
	onOpenChange,
	open,
}: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const [name, setName] = useState("");

	useEffect(() => {
		if (open) {
			setName("");
		}
	}, [open]);

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						if (name.trim() === "") {
							return;
						}
						const org = createOrg(name);
						toast.success(`Switched to “${org.name}”.`);
						onOpenChange(false);
					}}
				>
					<DialogHeader>
						<DialogTitle>Create organization</DialogTitle>
						<DialogDescription>
							A separate tenant for a team or project. Its nodes, servers, and
							templates stay isolated from your other orgs.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-2 py-4">
						<Label htmlFor="org-name">Name</Label>
						<Input
							autoFocus
							id="org-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="My Team"
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
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
