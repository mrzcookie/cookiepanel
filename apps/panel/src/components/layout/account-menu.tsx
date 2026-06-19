import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, Shield, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth-client";
import { initials } from "@/lib/format";
import { fetchIsPlatformAdmin } from "@/server/auth/session";

export function AccountMenu() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const user = session?.user;

	// Whether to show the /admin entry: a server-verified capability (the same
	// check `requirePlatformAdmin` enforces), not a client guess — so it matches exactly
	// who the admin guard admits, including env-bootstrapped admins. Hidden until
	// confirmed.
	const { data: isPlatformAdmin } = useQuery({
		queryKey: ["auth", "is-admin"],
		queryFn: () => fetchIsPlatformAdmin(),
		staleTime: 5 * 60 * 1000,
	});

	const init = initials(user?.name);

	async function logOut() {
		const { error } = await authClient.signOut();
		if (error) {
			toast.error(error.message ?? "Couldn't log you out.");
			return;
		}
		// Leave the org-scoped surface first, then drop its cached data so the next
		// user in this tab never sees the previous session's queries.
		await navigate({ to: "/login" });
		queryClient.clear();
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className="size-8 rounded-full" size="icon" variant="ghost">
					{user ? (
						<Avatar className="size-7">
							{user.image ? <AvatarImage alt="" src={user.image} /> : null}
							<AvatarFallback>
								{init ? init : <UserRound className="size-4" />}
							</AvatarFallback>
						</Avatar>
					) : (
						// Blank skeleton while the session resolves — rendered in place of
						// the Avatar (not inside it) so there's no ring outline, matching the
						// profile card's loading state.
						<Skeleton className="size-7 rounded-full" />
					)}
					<span className="sr-only">Open account menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					{user ? (
						<div className="flex min-w-0 flex-col">
							<span className="truncate font-medium text-sm">
								{user.name || user.email}
							</span>
							{user.name ? (
								<span className="truncate text-muted-foreground text-xs">
									{user.email}
								</span>
							) : null}
						</div>
					) : (
						<div className="flex flex-col gap-1.5 py-0.5">
							<Skeleton className="h-3.5 w-24" />
							<Skeleton className="h-3 w-32" />
						</div>
					)}
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/account">
						<UserRound />
						Account
					</Link>
				</DropdownMenuItem>
				{isPlatformAdmin ? (
					<DropdownMenuItem asChild>
						<Link to="/admin">
							<Shield />
							Admin
						</Link>
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={logOut}>
					<LogOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
