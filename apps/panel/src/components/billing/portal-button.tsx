import { Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Hands off to Polar's hosted, PCI-scoped checkout/portal: `action` calls a
// server fn that returns the hosted URL (`startNodeCheckout` / `openBillingPortal`),
// then we redirect the browser there. Polar returns to /settings/billing and the
// webhook reconciles the result, so there's nothing to do on the way back beyond
// the refetch the billing query already does on focus. We never touch card data.
export function PortalButton({
	icon,
	label,
	action,
	openingMessage = "Opening Polar's secure billing portal…",
	size = "sm",
	variant = "default",
	className,
}: {
	icon?: ReactNode;
	label: string;
	/** Returns the hosted Polar URL to redirect to. */
	action: () => Promise<{ url: string }>;
	openingMessage?: string;
	size?: ComponentProps<typeof Button>["size"];
	variant?: ComponentProps<typeof Button>["variant"];
	className?: string;
}) {
	const [pending, setPending] = useState(false);

	return (
		<Button
			className={className}
			disabled={pending}
			onClick={async () => {
				setPending(true);
				toast.info(openingMessage);
				try {
					const { url } = await action();
					// Leaves the page — keep `pending` so the button stays disabled
					// through the navigation.
					window.location.href = url;
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: "Couldn't open billing. Please try again."
					);
					setPending(false);
				}
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
