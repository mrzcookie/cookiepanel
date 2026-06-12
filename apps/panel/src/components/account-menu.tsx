import { Link } from "@tanstack/react-router";
import { LogOut, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CURRENT_USER } from "@/lib/stubs";

export function AccountMenu() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button className="size-8 rounded-full" size="icon" variant="ghost">
					<Avatar className="size-7">
						<AvatarFallback>
							<UserRound className="size-4" />
						</AvatarFallback>
					</Avatar>
					<span className="sr-only">Open account menu</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					<div className="flex min-w-0 flex-col">
						<span className="truncate font-medium text-sm">
							{CURRENT_USER.name}
						</span>
						<span className="truncate text-muted-foreground text-xs">
							{CURRENT_USER.email}
						</span>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/account">
						<UserRound />
						Account
					</Link>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{/* Inert until auth lands. */}
				<DropdownMenuItem>
					<LogOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
