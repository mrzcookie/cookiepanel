import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { createOrganization } from "@/lib/org";
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
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: orgs, refetch: refetchOrgs } =
		authClient.useListOrganizations();
	const { data: active, refetch: refetchActive } =
		authClient.useActiveOrganization();
	const [createOpen, setCreateOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	// Better Auth's org atoms are module-level singletons that only auto-fetch on
	// their first-ever mount; afterwards they refresh on a create/switch signal
	// only while something is subscribed. The switcher isn't mounted during
	// onboarding (it lives in the _app shell), so the new org's create signal is
	// missed and the list shows stale on arrival. The switcher only (re)mounts on
	// entry to the app shell — after onboarding or login — so refetch then.
	useEffect(() => {
		refetchOrgs();
		refetchActive();
	}, [refetchOrgs, refetchActive]);

	async function switchTo(organizationId: string) {
		if (organizationId === active?.id || busy) {
			return;
		}
		setBusy(true);
		const { error } = await authClient.organization.setActive({
			organizationId,
		});
		if (error) {
			setBusy(false);
			toast.error(error.message ?? "Couldn't switch organization.");
			return;
		}
		// Drop org-scoped query caches so every view reloads for the new org, then
		// land on the overview (the page we're on may belong to the old org).
		queryClient.clear();
		await navigate({ to: "/" });
		setBusy(false);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						className="flex w-full items-center gap-2 rounded-lg border bg-card px-2 py-1.5 text-left transition-colors hover:bg-muted aria-expanded:bg-muted group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:px-0"
						type="button"
					>
						{active ? (
							<>
								<OrgInitial name={active.name} />
								<span className="min-w-0 flex-1 truncate font-medium text-sm group-data-[collapsible=icon]:hidden">
									{active.name}
								</span>
							</>
						) : (
							<>
								<Skeleton className="size-6 shrink-0 rounded-sm" />
								<Skeleton className="h-4 min-w-0 flex-1 group-data-[collapsible=icon]:hidden" />
							</>
						)}
						<ChevronsUpDown className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
						<span className="sr-only">Switch organization</span>
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-60">
					<DropdownMenuLabel className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
						Organizations
					</DropdownMenuLabel>
					{(orgs ?? []).map((org) => (
						<DropdownMenuItem key={org.id} onClick={() => switchTo(org.id)}>
							<OrgInitial name={org.name} />
							<span className="min-w-0 flex-1 truncate">{org.name}</span>
							{org.id === active?.id ? (
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
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (open) {
			setName("");
		}
	}, [open]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (trimmed === "" || creating) {
			return;
		}
		setCreating(true);
		// createOrganization sets the new org active, so just reset the org-scoped
		// caches and land on the overview for it.
		const { error } = await createOrganization(trimmed);
		if (error) {
			setCreating(false);
			toast.error(error.message ?? "Couldn't create the organization.");
			return;
		}
		queryClient.clear();
		toast.success(`Switched to “${trimmed}”.`);
		onOpenChange(false);
		setCreating(false);
		await navigate({ to: "/" });
	}

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<form onSubmit={submit}>
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
						<Button disabled={name.trim() === "" || creating} type="submit">
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
