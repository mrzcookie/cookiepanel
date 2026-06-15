import { Download, Receipt } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusIndicator } from "@/components/shared/status-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { Invoice } from "@/lib/domain/billing";
import { formatMoney } from "@/lib/format";
import { invoiceStatus } from "@/lib/status";

// Past charges. Invoices live in Polar (its hosted, MoR receipts); we render a
// client-safe projection and link out for the PDF.
export function InvoiceHistory({ invoices }: { invoices: Invoice[] }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Invoices</CardTitle>
				<CardDescription>
					Receipts for this organization's payments.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{invoices.length === 0 ? (
					<EmptyState
						description="Invoices show up here after your first payment."
						icon={Receipt}
						title="No invoices yet"
					/>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Invoice</TableHead>
								<TableHead>Date</TableHead>
								<TableHead className="text-right">Amount</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="w-0">
									<span className="sr-only">Download</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{invoices.map((invoice) => (
								<TableRow key={invoice.id}>
									<TableCell className="font-mono text-xs">
										{invoice.number}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{invoice.date}
									</TableCell>
									<TableCell className="text-right font-mono tabular-nums">
										{formatMoney(invoice.amountCents)}
									</TableCell>
									<TableCell>
										<StatusIndicator status={invoiceStatus(invoice.status)} />
									</TableCell>
									<TableCell>
										<Button
											className="size-7 text-muted-foreground"
											onClick={() => toast.info("Opening invoice…")}
											size="icon"
											type="button"
											variant="ghost"
										>
											<Download />
											<span className="sr-only">
												Download invoice {invoice.number}
											</span>
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
