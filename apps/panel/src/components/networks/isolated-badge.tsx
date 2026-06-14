import { ShieldOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// An isolated network has no outbound access. Shared so the chip reads the same
// on the networks list, a network's detail, and a node's networking tab.
export function IsolatedBadge() {
	return (
		<Badge variant="secondary">
			<ShieldOff />
			Isolated
		</Badge>
	);
}
