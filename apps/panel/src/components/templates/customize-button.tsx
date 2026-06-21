import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { invalidateTemplates } from "@/lib/templates-queries";
import { forkTemplate } from "@/server/templates";

/**
 * Make an editable copy of a template in the active org. "Customize" rather than
 * "fork" in user-facing copy; lineage is recorded as "Based on X". Always an
 * org-side action — it copies an official (or own) template into the active org.
 */
export function CustomizeButton({ templateId }: { templateId: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);

	async function customize() {
		setBusy(true);
		try {
			const copy = await forkTemplate({ data: { id: templateId } });
			await invalidateTemplates(queryClient);
			toast.success("Copied to your templates.");
			navigate({
				params: { templateId: copy.id },
				to: "/templates/$templateId/edit",
			});
		} catch {
			toast.error("Couldn't customize that template. Try again.");
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
