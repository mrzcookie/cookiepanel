import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { Cookie, Loader2, MailCheck, OctagonAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { fetchSession } from "@/server/auth/session";

export const Route = createFileRoute("/accept-invitation/$invitationId")({
	// Accepting needs a session bound to the invited email, so send signed-out
	// visitors to log in (a magic link creates the account for new invitees) and
	// then back here. This route lives outside `_app`, so the no-active-org guard
	// doesn't bounce an invitee who has no org yet.
	beforeLoad: async ({ params }) => {
		if (!(await fetchSession())) {
			throw redirect({
				to: "/login",
				search: { redirect: `/accept-invitation/${params.invitationId}` },
			});
		}
	},
	component: AcceptInvitation,
});

type Invitation = NonNullable<
	Awaited<ReturnType<typeof authClient.organization.getInvitation>>["data"]
>;

function AcceptInvitation() {
	const { invitationId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<"loading" | "ready" | "error">(
		"loading"
	);
	const [invitation, setInvitation] = useState<Invitation | null>(null);
	const [errorMessage, setErrorMessage] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		// Better Auth checks the invitation is pending, unexpired, and addressed to
		// the signed-in user's email; anything else comes back as an error.
		authClient.organization
			.getInvitation({ query: { id: invitationId } })
			.then(({ data, error }) => {
				if (!active) {
					return;
				}
				if (error || !data) {
					setErrorMessage(
						error?.message ?? "This invitation is no longer valid."
					);
					setStatus("error");
					return;
				}
				setInvitation(data);
				setStatus("ready");
			});
		return () => {
			active = false;
		};
	}, [invitationId]);

	async function accept() {
		setBusy(true);
		const { error } = await authClient.organization.acceptInvitation({
			invitationId,
		});
		if (error) {
			setBusy(false);
			toast.error(error.message ?? "Couldn't accept the invitation.");
			return;
		}
		// Accepting makes the joined org the active one (Better Auth), so head
		// straight in — resetting any caches first.
		queryClient.clear();
		toast.success(`Joined ${invitation?.organizationName}.`);
		await navigate({ to: "/" });
	}

	async function decline() {
		setBusy(true);
		const { error } = await authClient.organization.rejectInvitation({
			invitationId,
		});
		if (error) {
			setBusy(false);
			toast.error(error.message ?? "Couldn't decline the invitation.");
			return;
		}
		toast.success("Invitation declined.");
		await navigate({ to: "/" });
	}

	return (
		<main className="flex min-h-svh flex-col items-center justify-center bg-background px-6">
			<div className="w-full max-w-sm space-y-6">
				<Link
					className="flex items-center justify-center gap-2 font-bold text-base tracking-tight"
					to="/home"
				>
					<Cookie className="size-5 text-primary" strokeWidth={2} />
					CookiePanel
				</Link>

				{status === "loading" ? (
					<div className="flex justify-center py-8">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : null}

				{status === "error" ? (
					<div className="space-y-4 text-center">
						<OctagonAlert className="mx-auto size-6 text-warn" />
						<div className="space-y-1.5">
							<h1 className="font-bold text-xl tracking-tight">
								Invitation unavailable
							</h1>
							<p className="text-muted-foreground text-sm">{errorMessage}</p>
						</div>
						<Button asChild size="sm" variant="outline">
							<Link to="/">Back to CookiePanel</Link>
						</Button>
					</div>
				) : null}

				{status === "ready" && invitation ? (
					<>
						<div className="space-y-1.5 text-center">
							<MailCheck className="mx-auto size-5 text-primary" />
							<div className="font-mono text-[0.7rem] text-muted-foreground uppercase tracking-[0.18em]">
								{"// invitation"}
							</div>
							<h1 className="font-bold text-2xl tracking-tight">
								Join {invitation.organizationName}
							</h1>
							<p className="text-muted-foreground text-sm">
								{invitation.inviterEmail} invited you to join as{" "}
								<span className="font-medium text-foreground">
									{roleLabel(invitation.role)}
								</span>
								.
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<Button disabled={busy} onClick={accept}>
								{busy ? <Loader2 className="animate-spin" /> : null}
								Accept invitation
							</Button>
							<Button
								disabled={busy}
								onClick={decline}
								type="button"
								variant="ghost"
							>
								Decline
							</Button>
						</div>
					</>
				) : null}
			</div>
		</main>
	);
}

/** "admin" → "Admin". */
function roleLabel(role: string) {
	return role.charAt(0).toUpperCase() + role.slice(1);
}
