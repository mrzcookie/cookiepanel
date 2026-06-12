import { createFileRoute } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/account/ssh-keys")({
	component: AccountSshKeys,
});

function AccountSshKeys() {
	return (
		<EmptyState
			action={<Button disabled>Add SSH key</Button>}
			description="Add a public key to access your servers' files over SFTP."
			icon={KeyRound}
			title="No SSH keys yet"
		/>
	);
}
