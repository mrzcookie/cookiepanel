import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ActivityList } from "@/components/shared/activity-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AdminActivityScope } from "@/lib/domain/admin";
import { ADMIN_ACTIVITY } from "@/lib/stubs/admin";

export const Route = createFileRoute("/admin/activity")({
	component: AdminActivity,
});

const FILTERS: { key: "all" | AdminActivityScope; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "platform", label: "Platform" },
	{ key: "tenant", label: "Tenants" },
];

function AdminActivity() {
	const [scope, setScope] = useState<"all" | AdminActivityScope>("all");
	const items =
		scope === "all"
			? ADMIN_ACTIVITY
			: ADMIN_ACTIVITY.filter((entry) => entry.scope === scope);

	return (
		<>
			<PageHeader
				actions={
					<div className="flex flex-wrap gap-1.5">
						{FILTERS.map((filter) => (
							<Button
								aria-pressed={scope === filter.key}
								key={filter.key}
								onClick={() => setScope(filter.key)}
								size="sm"
								variant={scope === filter.key ? "secondary" : "ghost"}
							>
								{filter.label}
							</Button>
						))}
					</div>
				}
				description="A global audit trail of meaningful admin and tenant actions across every organization."
				eyebrow="audit"
				title="Activity"
			/>

			<Card>
				<CardContent>
					<ActivityList items={items} />
				</CardContent>
			</Card>
		</>
	);
}
