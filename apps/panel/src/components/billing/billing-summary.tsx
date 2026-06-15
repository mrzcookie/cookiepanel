import type { ReactNode } from "react";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { StatusIndicator } from "@/components/shared/status-indicator";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type BillingState,
	billableNodeCount,
	freeNodeCount,
	monthlyTotalCents,
	projectedMonthlyCents,
} from "@/lib/domain/billing";
import { formatMoney, pluralize } from "@/lib/format";
import { billingStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The hero of the billing page: what the org pays, for how many nodes, in what
// state, billed to whom. Presentational — the page passes the right actions slot.

type CalloutTone = "warn" | "danger" | "muted";

const CALLOUT_TONE: Record<CalloutTone, string> = {
	warn: "border-warn/40 bg-warn-wash/40",
	danger: "border-destructive/40 bg-danger-wash/40",
	muted: "border-border bg-muted/40",
};

function costBreakdown(state: BillingState): string {
	const free = freeNodeCount(state);
	const billable = billableNodeCount(state);
	const price = formatMoney(state.pricePerNodeCents);
	const nodes = pluralize(state.nodeCount, "node");
	if (free > 0 && billable === 0) {
		return `${nodes}, free during your trial`;
	}
	if (free > 0) {
		return `${nodes} — ${free} free during your trial, ${billable} × ${price}`;
	}
	return `${nodes} × ${price}`;
}

function dateLine(
	state: BillingState
): { label: string; value: string } | null {
	switch (state.status) {
		case "active":
			return state.currentPeriodEnd
				? { label: "Renews on", value: state.currentPeriodEnd }
				: null;
		case "trialing":
			return state.trialEndsAt
				? { label: "Trial ends", value: state.trialEndsAt }
				: null;
		case "past_due":
			return state.graceEndsAt
				? { label: "Grace ends", value: state.graceEndsAt }
				: null;
		case "canceled":
			return state.currentPeriodEnd
				? { label: "Access ends", value: state.currentPeriodEnd }
				: null;
		default:
			return null;
	}
}

function Callout(state: BillingState): {
	tone: CalloutTone;
	body: ReactNode;
} | null {
	const projected = formatMoney(projectedMonthlyCents(state));
	switch (state.status) {
		case "trialing":
			return {
				tone: "warn",
				body: (
					<>
						Your first node is free until{" "}
						<span className="font-medium text-foreground">
							{state.trialEndsAt}
						</span>
						. After that you'll pay {projected}/month for{" "}
						{pluralize(state.nodeCount, "node")}.
						{state.paymentMethod
							? ""
							: " Add a payment method before then to avoid interruption."}
					</>
				),
			};
		case "past_due":
			return {
				tone: "danger",
				body: (
					<>
						Your last payment didn't go through. Update your card by{" "}
						<span className="font-medium text-foreground">
							{state.graceEndsAt}
						</span>{" "}
						to keep your nodes running — nothing is stopped before then.
					</>
				),
			};
		case "canceled":
			return {
				tone: "muted",
				body: (
					<>
						This plan is canceled. Your nodes stay managed until{" "}
						<span className="font-medium text-foreground">
							{state.currentPeriodEnd}
						</span>
						, then you can start a new plan anytime.
					</>
				),
			};
		default:
			return null;
	}
}

export function BillingSummary({
	state,
	actions,
}: {
	state: BillingState;
	actions?: ReactNode;
}) {
	const callout = Callout(state);
	const date = dateLine(state);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Plan</CardTitle>
				<CardDescription>
					{formatMoney(state.pricePerNodeCents)} per node, per month. Billed to
					the organization.
				</CardDescription>
				<CardAction>
					<StatusIndicator status={billingStatus(state.status)} />
				</CardAction>
			</CardHeader>
			<CardContent className="space-y-4">
				<div>
					<div className="flex items-baseline gap-1.5">
						<span className="font-mono text-3xl tabular-nums tracking-tight">
							{formatMoney(monthlyTotalCents(state))}
						</span>
						<span className="text-muted-foreground text-sm">/ month</span>
					</div>
					<p className="mt-1 text-muted-foreground text-sm">
						{costBreakdown(state)}
					</p>
				</div>

				{callout ? (
					<p
						className={cn(
							"rounded-lg border px-3 py-2.5 text-muted-foreground text-sm",
							CALLOUT_TONE[callout.tone]
						)}
					>
						{callout.body}
					</p>
				) : null}

				{date || state.billingContact ? (
					<DetailList>
						{date ? <DetailRow label={date.label} value={date.value} /> : null}
						{state.billingContact ? (
							<DetailRow
								label="Billed to"
								value={`${state.billingContact.name} · ${state.billingContact.email}`}
							/>
						) : null}
					</DetailList>
				) : null}
			</CardContent>
			{actions ? <CardFooter className="gap-2">{actions}</CardFooter> : null}
		</Card>
	);
}
