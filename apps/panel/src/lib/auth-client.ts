import {
	adminClient,
	inferAdditionalFields,
	magicLinkClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The Better Auth browser client (client-safe). Same-origin by default, so it
 * needs no base URL. Plugins mirror the server's (organization + admin + magic
 * link). `inferAdditionalFields` teaches the client about the custom `theme`
 * column — the config form (NOT `typeof auth`), so no server code reaches the
 * bundle — so `session.user.theme` is typed and `updateUser({ theme })` is
 * accepted.
 */
export const authClient = createAuthClient({
	plugins: [
		organizationClient(),
		adminClient(),
		magicLinkClient(),
		inferAdditionalFields({ user: { theme: { type: "string" } } }),
	],
});
