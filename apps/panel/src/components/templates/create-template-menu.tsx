import { Link } from "@tanstack/react-router";
import { ChevronDown, FileUp, Plus, SquarePen } from "lucide-react";
import { useState } from "react";
import { ImportTemplateDialog } from "@/components/templates/import-template-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TemplateScope } from "@/lib/templates-scope";

/** The list-page primary action: create from scratch, or import an egg. */
export function CreateTemplateMenu({ scope }: { scope: TemplateScope }) {
	const [importOpen, setImportOpen] = useState(false);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="sm">
						<Plus className="size-4" /> New template
						<ChevronDown className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem asChild>
						<Link to={scope.newPath as never}>
							<SquarePen className="size-4" /> Create from scratch
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setImportOpen(true)}>
						<FileUp className="size-4" /> Import a template
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ImportTemplateDialog
				onOpenChange={setImportOpen}
				open={importOpen}
				scope={scope}
			/>
		</>
	);
}
