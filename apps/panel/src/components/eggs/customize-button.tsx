import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { invalidateEggs } from "@/lib/eggs-queries";
import { forkEgg } from "@/server/eggs";

/**
 * Make an editable copy of an egg in the active org. "Customize" rather than
 * "fork" in user-facing copy; lineage is recorded as "Based on X". Always an
 * org-side action — it copies an official (or own) egg into the active org.
 */
export function CustomizeButton({ eggId }: { eggId: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);

	async function customize() {
		setBusy(true);
		try {
			const copy = await forkEgg({ data: { id: eggId } });
			await invalidateEggs(queryClient);
			toast.success("Copied to your eggs.");
			navigate({
				params: { eggId: copy.id },
				to: "/eggs/$eggId/edit",
			});
		} catch {
			toast.error("Couldn't customize that egg. Try again.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Button disabled={busy} onClick={customize} variant="outline">
			<Copy className="size-4" /> Customize
		</Button>
	);
}
