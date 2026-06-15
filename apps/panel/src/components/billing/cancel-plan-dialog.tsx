import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cancelSubscription } from "@/lib/stores/billing-store";

// Cancel a plan — set to end at the period close, not killed on the spot. Access
// (and the running servers) hold until `periodEnd`; nothing is deleted.
export function CancelPlanDialog({
	orgId,
	periodEnd,
}: {
	orgId: string;
	periodEnd: string | null;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button size="sm" variant="ghost">
					Cancel plan
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Cancel this plan?</DialogTitle>
					<DialogDescription>
						{periodEnd
							? `Your nodes keep running until ${periodEnd}. After that, the panel can no longer manage them until you start a new plan. Nothing is deleted.`
							: "Your nodes keep running until the end of the current period. After that, the panel can no longer manage them until you start a new plan. Nothing is deleted."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Keep plan
						</Button>
					</DialogClose>
					<Button
						onClick={() => {
							cancelSubscription(orgId);
							toast.success(
								"Plan canceled. It stays active until the period ends."
							);
							setOpen(false);
						}}
						type="button"
						variant="destructive"
					>
						Cancel plan
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
