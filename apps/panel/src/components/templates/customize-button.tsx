import { useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { forkTemplate } from "@/lib/stores/templates-store";

/**
 * Make an editable copy of a template in the active org. "Customize" rather than
 * "fork" in user-facing copy; lineage is recorded as "Based on X".
 */
export function CustomizeButton({ templateId }: { templateId: string }) {
	const navigate = useNavigate();

	function customize() {
		const copy = forkTemplate(templateId);
		if (!copy) {
			toast.error("Couldn't customize that template.");
			return;
		}
		toast.success("Copied to your templates.");
		navigate({
			params: { templateId: copy.id },
			to: "/templates/$templateId/edit",
		});
	}

	return (
		<Button onClick={customize} variant="outline">
			<Copy className="size-4" /> Customize
		</Button>
	);
}
