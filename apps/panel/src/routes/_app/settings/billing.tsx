import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { BillingSummary } from "@/components/billing/billing-summary";
import { CancelPlanDialog } from "@/components/billing/cancel-plan-dialog";
import { InvoiceHistory } from "@/components/billing/invoice-history";
import { PaymentMethod } from "@/components/billing/payment-method";
import { PortalButton } from "@/components/billing/portal-button";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { billingQueryOptions } from "@/lib/billing-queries";
import {
	openBillingPortal,
	resumeNodePlan,
	startNodeCheckout,
} from "@/server/billing";

export const Route = createFileRoute("/_app/settings/billing")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(billingQueryOptions()),
	component: SettingsBilling,
});

function SettingsBilling() {
	const { data: billing } = useSuspenseQuery(billingQueryOptions());
	const queryClient = useQueryClient();

	// Refetch after an in-place mutation (resume/cancel). Checkout/portal leave
	// the page, so their result is picked up by the refetch-on-focus return.
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["billing"] });

	if (billing.status === "none") {
		return (
			<div className="max-w-3xl">
				<EmptyState
					action={
						<Button asChild>
							<Link to="/nodes/new">Connect a node</Link>
						</Button>
					}
					description="Your first node is free for 30 days — you only pay once you go beyond it, at $10 per node each month. Connect a node to get started; there's nothing to buy up front."
					icon={CreditCard}
					title="No plan yet"
				/>
			</div>
		);
	}

	let summaryActions: ReactNode = null;
	let paymentAction: ReactNode = null;

	switch (billing.status) {
		case "trialing": {
			const label = billing.paymentMethod
				? "Update payment method"
				: "Add payment method";
			summaryActions = (
				<>
					<PortalButton
						action={() => startNodeCheckout()}
						icon={<CreditCard />}
						label={label}
					/>
					<CancelPlanDialog
						onCanceled={refresh}
						periodEnd={billing.trialEndsAt}
					/>
				</>
			);
			paymentAction = (
				<PortalButton
					action={() => startNodeCheckout()}
					label={billing.paymentMethod ? "Update" : "Add card"}
					variant="outline"
				/>
			);
			break;
		}
		case "active": {
			summaryActions = (
				<>
					<PortalButton
						action={() => openBillingPortal()}
						label="Manage billing"
						variant="outline"
					/>
					<CancelPlanDialog
						onCanceled={refresh}
						periodEnd={billing.currentPeriodEnd}
					/>
				</>
			);
			paymentAction = (
				<PortalButton
					action={() => openBillingPortal()}
					label="Update"
					variant="outline"
				/>
			);
			break;
		}
		case "past_due": {
			summaryActions = (
				<PortalButton
					action={() => openBillingPortal()}
					icon={<CreditCard />}
					label="Update payment method"
				/>
			);
			paymentAction = (
				<PortalButton action={() => openBillingPortal()} label="Update" />
			);
			break;
		}
		case "canceled": {
			summaryActions = (
				<>
					<Button
						onClick={async () => {
							try {
								await resumeNodePlan();
								toast.success("Plan resumed.");
								refresh();
							} catch (error) {
								toast.error(
									error instanceof Error
										? error.message
										: "Couldn't resume the plan."
								);
							}
						}}
						size="sm"
						type="button"
					>
						Resume plan
					</Button>
					<PortalButton
						action={() => openBillingPortal()}
						label="Manage billing"
						variant="outline"
					/>
				</>
			);
			paymentAction = (
				<PortalButton
					action={() => openBillingPortal()}
					label="Update"
					variant="outline"
				/>
			);
			break;
		}
		default:
			break;
	}

	return (
		<div className="max-w-3xl space-y-6">
			<BillingSummary actions={summaryActions} state={billing} />
			<PaymentMethod action={paymentAction} state={billing} />
			<InvoiceHistory invoices={billing.invoices} />
		</div>
	);
}
