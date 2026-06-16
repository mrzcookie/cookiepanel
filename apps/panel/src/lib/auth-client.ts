import {
	adminClient,
	magicLinkClient,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The Better Auth browser client (client-safe). Same-origin by default, so it
 * needs no base URL. Plugins mirror the server's (organization + admin + magic
 * link). The UI imports its hooks/actions (useSession, signIn.magicLink, …) when
 * auth is wired into pages — that wiring is a later step.
 */
export const authClient = createAuthClient({
	plugins: [organizationClient(), adminClient(), magicLinkClient()],
});
