import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { organization } from "@/server/db/schema/auth";

/**
 * The only module that touches the DB for the self-service organization views.
 * The org's mutable identity (name, logo) is owned by Better Auth's organization
 * plugin and written through its API (so its caches stay current and the update
 * permission is enforced) — see ./index.ts. This repository holds only the read
 * that API doesn't cheaply expose: the current logo URL, needed to clean up the
 * object being replaced (Better Auth's `getFullOrganization` would over-fetch
 * members + invitations for one column). A non-identity read like this has no
 * session/cookie-cache concern, so going direct is fine.
 */
export const organizationRepository = {
	/** The org's current logo URL, for cleanup of the object being replaced. */
	currentLogo: (orgId: string): Promise<string | null> =>
		db
			.select({ logo: organization.logo })
			.from(organization)
			.where(eq(organization.id, orgId))
			.limit(1)
			.then((rows) => rows.at(0)?.logo ?? null),
};
