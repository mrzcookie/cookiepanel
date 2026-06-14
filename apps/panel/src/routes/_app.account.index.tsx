import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
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
import { CURRENT_USER } from "@/lib/stubs";

export const Route = createFileRoute("/_app/account/")({
	component: AccountGeneral,
});

const ACCOUNT_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

function AccountGeneral() {
	// Track the last-saved values so Save disables until something actually
	// changes again (isDirty compares to the original defaults, not the save).
	const [saved, setSaved] = useState(CURRENT_USER);
	const form = useForm({
		defaultValues: CURRENT_USER,
		onSubmit: ({ value }) => {
			toast.success("Profile saved.");
			setSaved({ name: value.name.trim(), email: value.email.trim() });
		},
	});

	return (
		<div className="max-w-2xl space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
					<CardDescription>Your name, email, and avatar.</CardDescription>
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
							icon={UserRound}
							label="Upload avatar"
							shape="circle"
						/>
						<div className="grid gap-4">
							<form.Field name="name">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Name</Label>
										<Input
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="Your name"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
							<form.Field name="email">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Email</Label>
										<Input
											id={field.name}
											name={field.name}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											placeholder="you@example.com"
											type="email"
											value={field.state.value}
										/>
									</div>
								)}
							</form.Field>
						</div>
					</CardContent>
					<CardFooter>
						<form.Subscribe selector={(state) => state.values}>
							{(values) => {
								const name = values.name.trim();
								const email = values.email.trim();
								return (
									<Button
										disabled={
											!(name && email) ||
											(name === saved.name && email === saved.email)
										}
										type="submit"
									>
										Save changes
									</Button>
								);
							}}
						</form.Subscribe>
					</CardFooter>
				</form>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Appearance</CardTitle>
					<CardDescription>
						Choose how CookiePanel looks to you.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ThemeSwitcher />
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Details</CardTitle>
					<CardDescription>Identifiers for your account.</CardDescription>
				</CardHeader>
				<CardContent>
					<DetailList>
						<DetailRow copyable label="Account ID" value={ACCOUNT_ID} />
						<DetailRow label="Member since" value="Jun 11, 2026" />
					</DetailList>
				</CardContent>
			</Card>
		</div>
	);
}
