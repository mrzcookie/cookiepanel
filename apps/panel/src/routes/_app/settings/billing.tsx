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
import {
	attachPaymentMethod,
	recoverFromPastDue,
	resumeSubscription,
	useBilling,
} from "@/lib/stores/billing-store";
import { useActiveOrg } from "@/lib/stores/orgs-store";

export const Route = createFileRoute("/_app/settings/billing")({
	component: SettingsBilling,
});

function SettingsBilling() {
	const org = useActiveOrg();
	const billing = useBilling(org.id);

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
						icon={<CreditCard />}
						label={label}
						onReturn={() => attachPaymentMethod(org.id)}
						successMessage="Payment method saved."
					/>
					<CancelPlanDialog orgId={org.id} periodEnd={billing.trialEndsAt} />
				</>
			);
			paymentAction = (
				<PortalButton
					label={billing.paymentMethod ? "Update" : "Add card"}
					onReturn={() => attachPaymentMethod(org.id)}
					successMessage="Payment method saved."
					variant="outline"
				/>
			);
			break;
		}
		case "active": {
			summaryActions = (
				<>
					<PortalButton label="Manage billing" variant="outline" />
					<CancelPlanDialog
						orgId={org.id}
						periodEnd={billing.currentPeriodEnd}
					/>
				</>
			);
			paymentAction = (
				<PortalButton
					label="Update"
					onReturn={() => attachPaymentMethod(org.id)}
					successMessage="Payment method updated."
					variant="outline"
				/>
			);
			break;
		}
		case "past_due": {
			summaryActions = (
				<PortalButton
					icon={<CreditCard />}
					label="Update payment method"
					onReturn={() => recoverFromPastDue(org.id)}
					successMessage="Payment method updated — you're all set."
				/>
			);
			paymentAction = (
				<PortalButton
					label="Update"
					onReturn={() => recoverFromPastDue(org.id)}
					successMessage="Payment method updated — you're all set."
				/>
			);
			break;
		}
		case "canceled": {
			summaryActions = (
				<>
					<Button
						onClick={() => {
							resumeSubscription(org.id);
							toast.success("Plan resumed.");
						}}
						size="sm"
						type="button"
					>
						Resume plan
					</Button>
					<PortalButton label="Manage billing" variant="outline" />
				</>
			);
			paymentAction = (
				<PortalButton
					label="Update"
					onReturn={() => attachPaymentMethod(org.id)}
					successMessage="Payment method updated."
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
