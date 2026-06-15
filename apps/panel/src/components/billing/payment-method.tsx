import { CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { BillingState } from "@/lib/domain/billing";

// The card funding the org's plan. We only ever hold a display projection — brand
// + last four — never a number or token; Polar's hosted portal owns the real card.
export function PaymentMethod({
	state,
	action,
}: {
	state: BillingState;
	action?: ReactNode;
}) {
	const card = state.paymentMethod;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Payment method</CardTitle>
				<CardDescription>
					Funds this organization's plan. Managed securely by Polar.
				</CardDescription>
				{action ? <CardAction>{action}</CardAction> : null}
			</CardHeader>
			<CardContent>
				{card ? (
					<div className="flex items-center gap-3">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
							<CreditCard className="size-4" />
						</span>
						<div className="min-w-0">
							<p className="font-mono text-sm">
								{card.brand} ···· {card.last4}
							</p>
							<p className="text-muted-foreground text-xs">
								Expires {String(card.expMonth).padStart(2, "0")} /{" "}
								{card.expYear}
							</p>
						</div>
					</div>
				) : (
					<p className="text-muted-foreground text-sm">
						No card on file yet. Add one to keep your nodes running after the
						trial.
					</p>
				)}
			</CardContent>
		</Card>
	);
}
