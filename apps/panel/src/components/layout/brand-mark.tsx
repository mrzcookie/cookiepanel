import { Bird } from "lucide-react";
import { cn } from "@/lib/utils";

// The Raptor brand mark — the single source of the logo glyph, used wherever the
// wordmark appears (sidebar, auth pages, landing, error screen). Swap the glyph
// here (e.g. drop in a custom SVG) to restyle the logo everywhere at once.
// Decorative: the adjacent "Raptor Panel" wordmark carries the accessible name.
export function BrandMark({
	className,
	strokeWidth = 2,
}: {
	className?: string;
	strokeWidth?: number;
}) {
	return (
		<Bird
			aria-hidden
			className={cn("size-5 text-primary", className)}
			strokeWidth={strokeWidth}
		/>
	);
}
