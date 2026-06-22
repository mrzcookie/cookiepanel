import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import {
	ActivityList,
	toActivityItem,
} from "@/components/shared/activity-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { allActivityQueryOptions } from "@/lib/activity-queries";

export const Route = createFileRoute("/admin/activity")({
	loader: ({ context }) =>
		context.queryClient.ensureInfiniteQueryData(allActivityQueryOptions()),
	component: AdminActivity,
});

function AdminActivity() {
	const query = useSuspenseInfiniteQuery(allActivityQueryOptions());
	const items = query.data.pages.flat().map(toActivityItem);

	return (
		<>
			<PageHeader
				description="A global audit trail of meaningful actions across every organization."
				eyebrow="audit"
				title="Activity"
			/>

			<Card>
				<CardContent className="space-y-6">
					<ActivityList items={items} />
					{query.hasNextPage ? (
						<Button
							disabled={query.isFetchingNextPage}
							onClick={() => query.fetchNextPage()}
							size="sm"
							variant="outline"
						>
							{query.isFetchingNextPage ? (
								<Loader2 className="animate-spin" />
							) : null}
							Load more
						</Button>
					) : null}
				</CardContent>
			</Card>
		</>
	);
}
