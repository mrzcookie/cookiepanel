import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// A button that hands off to Polar's hosted, PCI-scoped checkout/portal and comes
// back. Today it simulates that round-trip (a short pending state, like the
// connect-node wizard's first heartbeat); the real version redirects the browser
// to a `polar.customerSessions` / `polar.checkouts` URL and reconciles the result
// from the webhook. `onReturn` runs when we're "back" — wire it to the store
// mutation the return implies (a card attached, a past-due plan recovered).

const ROUNDTRIP_MS = 1100;

export function PortalButton({
	icon,
	label,
	onReturn,
	openingMessage = "Opening Polar's secure billing portal…",
	successMessage,
	size = "sm",
	variant = "default",
	className,
}: {
	icon?: ReactNode;
	label: string;
	onReturn?: () => void;
	openingMessage?: string;
	successMessage?: string;
	size?: ComponentProps<typeof Button>["size"];
	variant?: ComponentProps<typeof Button>["variant"];
	className?: string;
}) {
	const [pending, setPending] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[]
	);

	return (
		<Button
			className={className}
			disabled={pending}
			onClick={() => {
				setPending(true);
				toast.info(openingMessage);
				timer.current = setTimeout(() => {
					onReturn?.();
					if (successMessage) {
						toast.success(successMessage);
					}
					setPending(false);
				}, ROUNDTRIP_MS);
			}}
			size={size}
			type="button"
			variant={variant}
		>
			{pending ? <Loader2 className="animate-spin" /> : icon}
			{pending ? "Redirecting…" : label}
		</Button>
	);
}
