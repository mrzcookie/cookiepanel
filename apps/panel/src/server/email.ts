import { Resend } from "resend";
import { env } from "@/server/env";
import { log } from "@/server/log";

export type SendEmailOptions = {
	to: string | string[];
	subject: string;
	text: string;
	html?: string;
};

// Resend allows "Name <addr@host>"; fall back to their onboarding sender in dev.
const FROM = env.EMAIL_FROM ?? "Raptor <onboarding@resend.dev>";

/**
 * Send a transactional email via Resend. Shared across features — auth magic
 * links, org invitations, billing notices, and so on. With no RESEND_API_KEY
 * (local dev) the email is logged instead of sent, so flows stay testable
 * offline.
 */
export async function sendEmail({ to, subject, text, html }: SendEmailOptions) {
	if (!env.RESEND_API_KEY) {
		const recipients = Array.isArray(to) ? to.join(", ") : to;
		if (env.NODE_ENV === "production") {
			// A prod box with no key is a misconfiguration — surface it loudly, but
			// never log the body: magic-link emails carry a sign-in token in `text`.
			log.error("email: RESEND_API_KEY unset in production; email dropped", {
				to: recipients,
				subject,
			});
			return;
		}
		// Local dev: print the full email (incl. the magic-link URL) so auth flows
		// stay testable offline.
		log.warn("email: no RESEND_API_KEY, logging instead of sending", {
			to: recipients,
			subject,
			text,
		});
		return;
	}

	const resend = new Resend(env.RESEND_API_KEY);
	const { error } = await resend.emails.send({
		from: FROM,
		to,
		subject,
		text,
		...(html ? { html } : {}),
	});

	if (error) {
		throw new Error(`Failed to send email: ${error.message}`);
	}
}
