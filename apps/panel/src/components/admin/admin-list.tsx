import { type LucideIcon, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableHeader } from "@/components/ui/table";

// The shared chrome for an admin list: a searchable, card-wrapped table. The
// caller supplies the column header row and a keyed row per item; this owns the
// search box, the filtering, and the empty / no-results states — so every admin
// list (users, organizations, nodes, subdomains) reads identically.
export function AdminList<T>({
	items,
	filter,
	searchPlaceholder,
	head,
	row,
	icon,
	emptyTitle,
	emptyDescription,
}: {
	items: T[];
	filter: (item: T, query: string) => boolean;
	searchPlaceholder: string;
	/** A `<TableRow>` of `<TableHead>` cells. */
	head: ReactNode;
	/** A keyed `<TableRow>` for one item. */
	row: (item: T) => ReactNode;
	icon: LucideIcon;
	emptyTitle: string;
	emptyDescription: string;
}) {
	const [query, setQuery] = useState("");
	const trimmed = query.trim();
	const needle = trimmed.toLowerCase();
	const filtered = needle
		? items.filter((item) => filter(item, needle))
		: items;

	return (
		<Card>
			<CardContent className="space-y-4">
				<div className="relative max-w-xs">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						className="pl-8"
						onChange={(event) => setQuery(event.target.value)}
						placeholder={searchPlaceholder}
						value={query}
					/>
				</div>
				{items.length === 0 ? (
					<EmptyState
						description={emptyDescription}
						icon={icon}
						title={emptyTitle}
					/>
				) : filtered.length === 0 ? (
					<EmptyState
						description={`Nothing matches “${trimmed}”.`}
						icon={Search}
						title="No matches"
					/>
				) : (
					<Table>
						<TableHeader>{head}</TableHeader>
						<TableBody>{filtered.map(row)}</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
