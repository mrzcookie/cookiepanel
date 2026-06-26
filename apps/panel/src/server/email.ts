import { Resend } from "resend";
import { env } from "@/server/env";

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
		console.warn(
			`[email] (no RESEND_API_KEY) to ${recipients}: ${subject}\n${text}`
		);
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
