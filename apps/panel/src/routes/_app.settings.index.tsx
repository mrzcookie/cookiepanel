import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DetailList, DetailRow } from "@/components/shared/detail-list";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/slug";

export const Route = createFileRoute("/_app/settings/")({
	component: SettingsGeneral,
});

const ORG_ID = "c3a4e1f2-7b8d-4e9a-a1b2-3c4d5e6f7a8b";

function SettingsGeneral() {
	const [savedName, setSavedName] = useState("Acme Servers");
	// The slug follows the saved name, not what's currently being typed.
	const slug = slugify(savedName) || "—";

	const form = useForm({
		defaultValues: { name: "Acme Servers" },
		onSubmit: ({ value }) => {
			setSavedName(value.name.trim());
			toast.success("Organization saved.");
		},
	});

	return (
		<div className="max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Organization</CardTitle>
					<CardDescription>Your organization's name and logo.</CardDescription>
				</CardHeader>
				<form
					className="contents"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<CardContent className="space-y-6">
						<ImageUploadField
							icon={Building2}
							label="Upload logo"
							shape="square"
						/>
						<form.Field name="name">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>Name</Label>
									<Input
										id={field.name}
										name={field.name}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder="Acme Servers"
										value={field.state.value}
									/>
								</div>
							)}
						</form.Field>
					</CardContent>
					<CardFooter>
						<form.Subscribe selector={(state) => state.values.name}>
							{(currentName) => (
								<Button
									disabled={
										currentName.trim() === savedName ||
										currentName.trim() === ""
									}
									type="submit"
								>
									Save changes
								</Button>
							)}
						</form.Subscribe>
					</CardFooter>
				</form>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Details</CardTitle>
					<CardDescription>
						Identifiers for this organization. The slug is generated from the
						name.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<DetailList>
						<DetailRow copyable label="Organization ID" value={ORG_ID} />
						<DetailRow copyable label="Slug" value={slug} />
						<DetailRow label="Created" value="Jun 11, 2026" />
					</DetailList>
				</CardContent>
			</Card>
		</div>
	);
}
