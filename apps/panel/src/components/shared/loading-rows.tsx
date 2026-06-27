import { Skeleton } from "@/components/ui/skeleton";

const ROW_KEYS = ["a", "b", "c", "d", "e", "f"];

// Placeholder rows for a list/table that's loading — a chip + two text lines
// each. Replaces a bare centred spinner so the surface keeps its shape.
export function LoadingRows({ rows = 4 }: { rows?: number }) {
	return (
		<div className="space-y-3">
			{ROW_KEYS.slice(0, rows).map((key) => (
				<div className="flex items-center gap-3" key={key}>
					<Skeleton className="size-9 shrink-0 rounded-lg" />
					<div className="flex-1 space-y-2">
						<Skeleton className="h-3.5 w-1/3" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				</div>
			))}
		</div>
	);
}
