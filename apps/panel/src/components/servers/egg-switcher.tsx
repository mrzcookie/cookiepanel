import { Button } from "@/components/ui/button";
import { isDeployable } from "@/lib/domain/eggs";
import type { ServerRow } from "@/lib/domain/servers";
import { useEggs } from "@/lib/eggs-queries";

// Switch the egg a server runs on. Not available yet — it needs the daemon
// reinstall/recreate pipeline — so the action is shown disabled rather than
// faking a switch. Hidden when there's no other deployable egg to switch to.
export function ChangeEggButton({ server }: { server: ServerRow }) {
	const eggs = useEggs();
	const canSwitch = eggs.some(
		(egg) => egg.id !== server.eggId && isDeployable(egg)
	);

	if (!canSwitch) {
		return null;
	}

	return (
		<Button
			disabled
			size="sm"
			title="Changing a server's egg isn't available yet"
			variant="outline"
		>
			Change egg
		</Button>
	);
}
